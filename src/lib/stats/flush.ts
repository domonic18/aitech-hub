/**
 * 统计缓冲落库(worker 每 60s 调用,批C 从 service 平移):
 * 读取 Redis 日缓冲键(stats:buf:*),RENAME 私有键后落聚合表
 * (stats_visit/referrer/page/client/post_view_daily + views_count 累加)。
 * 键形契约:写入侧见 service.ts ingestView(`stats:buf:<kind>:<day>[:pv|uv]`),
 * 两侧改名需同批;复杂聚合 SQL 集中本文件($executeRaw 仅 service 层内合法,arch/05-services §2)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";

async function scanBufferKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", "stats:buf:*", "COUNT", 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

export interface FlushSummary {
  keysFlushed: number;
  postRows: number;
}

/**
 * 缓冲落库:RENAME 到私有键后再读(HGETALL 与 DEL 之间的新增事件留在原键,
 * 下轮再刷),按键形态分发到对应聚合表;失败把数据键还原,下轮重试。
 */
export async function flushStatsBuffer(): Promise<FlushSummary> {
  const keys = await scanBufferKeys();
  let keysFlushed = 0;
  let postRows = 0;
  for (const key of keys) {
    const tmp = `stats:flushing:${Math.random().toString(36).slice(2)}:${key}`;
    try {
      await redis.rename(key, tmp);
    } catch {
      continue; // 键已被处理或过期
    }
    try {
      const fields = await redis.hgetall(tmp);
      postRows += await applyBufferKey(key, fields);
      await redis.del(tmp);
      keysFlushed++;
    } catch (e) {
      console.error(JSON.stringify({ event: "stats.flush.failed", key, error: String(e) }));
      await redis.rename(tmp, key).catch(() => undefined);
    }
  }
  return { keysFlushed, postRows };
}

async function applyBufferKey(key: string, fields: Record<string, string>): Promise<number> {
  const parts = key.split(":"); // stats:buf:<kind>:<day>[:pv|uv]
  const kind = parts[2];
  const day = parts[3];
  if (!day) return 0;
  switch (kind) {
    case "visit":
      await upsertVisit(day, num(fields.pv), num(fields.uv));
      return 0;
    case "ref":
      await upsertReferrers(day, fields);
      return 0;
    case "page": {
      const isPv = parts[4] === "pv";
      await upsertPages(day, fields, isPv);
      return 0;
    }
    case "client":
      await upsertClients(day, fields);
      return 0;
    case "post": {
      const ids = Object.keys(fields);
      for (const id of ids) {
        await upsertPostView(day, id, num(fields[id]));
      }
      return ids.length;
    }
    default:
      return 0;
  }
}

function num(v: string | undefined): number {
  return Math.max(0, Number.parseInt(v ?? "0", 10) || 0);
}

async function upsertVisit(day: string, pv: number, uv: number): Promise<void> {
  if (pv <= 0 && uv <= 0) return;
  await prisma.$executeRaw`
    INSERT INTO stats_visit_daily (stat_date, pv, uv)
    VALUES (${day}::date, ${pv}, ${uv})
    ON CONFLICT (stat_date)
    DO UPDATE SET pv = stats_visit_daily.pv + EXCLUDED.pv, uv = stats_visit_daily.uv + EXCLUDED.uv`;
}

async function upsertReferrers(day: string, fields: Record<string, string>): Promise<void> {
  const rows = Object.entries(fields)
    .map(([k, v]) => {
      const [sourceClass, sourceName, metric] = k.split("|");
      return {
        sourceClass,
        sourceName,
        pv: metric === "pv" ? num(v) : 0,
        uv: metric === "uv" ? num(v) : 0,
      };
    })
    .filter((r) => r.pv > 0 || r.uv > 0);
  if (rows.length === 0) return;
  await prisma.$transaction(
    rows.map(
      (r) => prisma.$executeRaw`
      INSERT INTO stats_referrer_daily (stat_date, source_class, source_name, pv, uv)
      VALUES (${day}::date, ${r.sourceClass}, ${r.sourceName}, ${r.pv}, ${r.uv})
      ON CONFLICT (stat_date, source_class, source_name)
      DO UPDATE SET pv = stats_referrer_daily.pv + EXCLUDED.pv, uv = stats_referrer_daily.uv + EXCLUDED.uv`,
    ),
  );
}

async function upsertPages(
  day: string,
  fields: Record<string, string>,
  isPv: boolean,
): Promise<void> {
  const rows = Object.entries(fields)
    .map(([path, v]) => ({ path, pv: isPv ? num(v) : 0, uv: isPv ? 0 : num(v) }))
    .filter((r) => r.pv > 0 || r.uv > 0);
  if (rows.length === 0) return;
  await prisma.$transaction(
    rows.map(
      (r) => prisma.$executeRaw`
      INSERT INTO stats_page_daily (stat_date, path, pv, uv)
      VALUES (${day}::date, ${r.path.slice(0, 500)}, ${r.pv}, ${r.uv})
      ON CONFLICT (stat_date, path)
      DO UPDATE SET ${isPv ? Prisma.sql`pv = stats_page_daily.pv + EXCLUDED.pv` : Prisma.sql`uv = stats_page_daily.uv + EXCLUDED.uv`}`,
    ),
  );
}

async function upsertClients(day: string, fields: Record<string, string>): Promise<void> {
  const rows = Object.entries(fields)
    .map(([k, v]) => {
      const [browser, os, deviceType] = k.split("|");
      return { browser, os, deviceType, pv: num(v) };
    })
    .filter((r) => r.pv > 0);
  if (rows.length === 0) return;
  await prisma.$transaction(
    rows.map(
      (r) => prisma.$executeRaw`
      INSERT INTO stats_client_daily (stat_date, browser, os, device_type, pv)
      VALUES (${day}::date, ${r.browser.slice(0, 50)}, ${r.os.slice(0, 50)}, ${r.deviceType.slice(0, 20)}, ${r.pv})
      ON CONFLICT (stat_date, browser, os, device_type)
      DO UPDATE SET pv = stats_client_daily.pv + EXCLUDED.pv`,
    ),
  );
}

/** 文章 PV:日行 UPSERT + 总数累加(与迁移来的历史阅读数直接累加,requirement §3.5) */
async function upsertPostView(day: string, postId: string, count: number): Promise<void> {
  if (count <= 0) return;
  const id = BigInt(postId);
  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO stats_post_view_daily (post_id, view_date, count)
      VALUES (${id}, ${day}::date, ${count})
      ON CONFLICT (post_id, view_date)
      DO UPDATE SET count = stats_post_view_daily.count + EXCLUDED.count`,
    prisma.post.update({ where: { id }, data: { viewsCount: { increment: BigInt(count) } } }),
  ]);
}
