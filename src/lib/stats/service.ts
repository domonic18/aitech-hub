/**
 * 站点统计 service(requirement §3.5;arch/05-services §1 分层):
 *  - ingestView:beacon 接收入口。去 bot/去管理员 → Redis 日缓冲
 *    (PV 直接缓冲;UV 按 IP+UA 哈希日去重;文章 PV 另设 1h 去重窗,arch/05-services §5);
 *    另同步落一行访问明细 stats_visit_log(全量 IP 短留存 7 天,M10 批⑥)。
 *  - flushStatsBuffer:worker 每 60s 将缓冲 RENAME 后落库聚合表
 *    (stats_visit/referrer/page/client/post_view_daily + views_count 累加)。
 *  - purgeVisitLogs:worker 日调度清理 7 天前明细行。
 * 复杂聚合 SQL 集中本文件($executeRaw 仅 service 层内合法,arch/05-services §2)。
 */
import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { statsDay } from "@/lib/datetime";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { parsePostSegment } from "@/lib/content/post-path";
import { classifyReferrer, isBotUa, normalizePagePath, parseClient, visitorHash } from "./classify";

const DAY_TTL_SECONDS = 86400; // UV 日去重窗口(当日有效)
const POST_DEDUP_TTL_SECONDS = 3600; // 文章阅读去重窗口(arch/05-services:IP+UA 去重窗口 1h)
const BUFFER_TTL_SECONDS = 172800; // 缓冲键兜底过期(worker 长期不可用时防堆积)
const POSTMAP_TTL_SECONDS = 3600; // id→发布态解析缓存(含负缓存 "0";id 锚定,解析仅验发布态)

export interface IngestInput {
  path: string;
  referrer: string | null;
  ua: string;
  ip: string;
  salt: string;
  isAdmin: boolean;
}

export interface IngestResult {
  counted: boolean;
  reason: "ok" | "bot" | "admin";
  postCounted: boolean;
}

/** 单次上报入账;任何 Redis 故障向上抛出,由调用方返回 5xx(beacon 不重试,可接受) */
export async function ingestView(input: IngestInput): Promise<IngestResult> {
  if (isBotUa(input.ua)) return { counted: false, reason: "bot", postCounted: false };
  if (input.isAdmin) return { counted: false, reason: "admin", postCounted: false };

  const day = statsDay();
  const path = normalizePagePath(input.path);
  const vhash = visitorHash(input.salt, input.ip, input.ua);

  // 日级访客去重(站点 UV)与页级访客去重(页面 UV)分别判定
  const [uvNew, pageUvNew] = await Promise.all([
    redis.set(`stats:uv:${day}:${vhash}`, "1", "EX", DAY_TTL_SECONDS, "NX"),
    redis.set(`stats:uvp:${day}:${vhash}:${hash16(path)}`, "1", "EX", DAY_TTL_SECONDS, "NX"),
  ]);
  const isUvNew = uvNew === "OK";
  const isPageUvNew = pageUvNew === "OK";

  const ref = classifyReferrer(input.referrer);
  const client = parseClient(input.ua);

  const pipe = redis.pipeline();
  pipe.hincrby(`stats:buf:visit:${day}`, "pv", 1);
  if (isUvNew) pipe.hincrby(`stats:buf:visit:${day}`, "uv", 1);
  pipe.hincrby(`stats:buf:ref:${day}`, `${ref.sourceClass}|${ref.sourceName}|pv`, 1);
  if (isUvNew) pipe.hincrby(`stats:buf:ref:${day}`, `${ref.sourceClass}|${ref.sourceName}|uv`, 1);
  pipe.hincrby(`stats:buf:page:${day}:pv`, path, 1);
  if (isPageUvNew) pipe.hincrby(`stats:buf:page:${day}:uv`, path, 1);
  pipe.hincrby(`stats:buf:client:${day}`, `${client.browser}|${client.os}|${client.deviceType}`, 1);
  pipe.expire(`stats:buf:visit:${day}`, BUFFER_TTL_SECONDS);
  pipe.expire(`stats:buf:ref:${day}`, BUFFER_TTL_SECONDS);
  pipe.expire(`stats:buf:page:${day}:pv`, BUFFER_TTL_SECONDS);
  pipe.expire(`stats:buf:page:${day}:uv`, BUFFER_TTL_SECONDS);
  pipe.expire(`stats:buf:client:${day}`, BUFFER_TTL_SECONDS);
  await pipe.exec();

  // 访问明细行(M10 批⑥):不 await 不阻断 beacon,失败仅告警(明细缺失可接受,
  // 聚合口径不受影响);IP 全量短留存,明文只进这张表
  prisma.statsVisitLog
    .create({
      data: {
        path,
        ip: input.ip.slice(0, 45),
        browser: client.browser.slice(0, 50),
        os: client.os.slice(0, 50),
        deviceType: client.deviceType.slice(0, 20),
        sourceClass: ref.sourceClass,
        sourceName: ref.sourceName.slice(0, 50),
        visitorHash: vhash,
      },
    })
    .catch((e: unknown) => logger.warn({ event: "stats.visit_log.failed", error: String(e) }));

  const postCounted = await countPostView(path, vhash, day);
  return { counted: true, reason: "ok", postCounted };
}

// ── 明细保留(worker 日调度,M10 批⑥)────────────────────────────────

/** 明细保留天数(2026-10-04 用户定调:全量 IP + 7 天短留存) */
const VISIT_LOG_RETENTION_DAYS = 7;

/** 清理保留窗口外的访问明细;返回删除行数(0 不打日志) */
export async function purgeVisitLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - VISIT_LOG_RETENTION_DAYS * 86_400_000);
  const r = await prisma.statsVisitLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return r.count;
}

function hash16(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

/** 文章页 PV:路径形如 /post/<id>(-<slug>)?/ 才计(2026-10 URL 终态,id 锚定);
 * 同访客同文章 1h 一窗(防刷新虚增阅读数)。旧单段路径不再归属文章(迁移过渡期缓存页上报,量小可弃)。 */
async function countPostView(path: string, vhash: string, day: string): Promise<boolean> {
  const seg = path.replace(/^\/+|\/+$/g, "");
  if (!seg.startsWith("post/")) return false;
  const parsed = parsePostSegment(seg.slice("post/".length));
  if (!parsed) return false;
  const postId = parsed.id.toString();

  const mapKey = `stats:postmap:${postId}`;
  let live = await redis.get(mapKey);
  if (live === null) {
    const row = await prisma.post.findUnique({
      where: { id: parsed.id },
      select: { status: true, publishedAt: true },
    });
    live = row && row.status === "published" && row.publishedAt !== null ? "1" : "0";
    await redis.set(mapKey, live, "EX", POSTMAP_TTL_SECONDS);
  }
  if (live === "0") return false;

  const fresh =
    (await redis.set(
      `stats:pvp:${day}:${vhash}:${postId}`,
      "1",
      "EX",
      POST_DEDUP_TTL_SECONDS,
      "NX",
    )) === "OK";
  if (!fresh) return false;
  await redis.hincrby(`stats:buf:post:${day}`, postId, 1);
  return true;
}

// ── flush(worker 每 60s 调用)────────────────────────────────────────

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
