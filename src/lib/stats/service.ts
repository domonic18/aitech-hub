/**
 * 站点统计 service(requirement §3.5;arch/05-services §1 分层):
 *  - ingestView:beacon 接收入口。去 bot/去管理员 → Redis 日缓冲
 *    (PV 直接缓冲;UV 按 IP+UA 哈希日去重;文章 PV 另设 1h 去重窗,arch/05-services §5);
 *    另同步落一行访问明细 stats_visit_log(全量 IP 短留存 7 天,M10 批⑥)。
 *  - purgeVisitLogs:worker 日调度清理 7 天前明细行。
 * 缓冲落库(flushStatsBuffer)在同级 flush.ts(worker 每 60s;
 * 缓冲键形 stats:buf:<kind>:<day> 由本文件写入、flush.ts 消费,改名需同批)。
 */
import { createHash } from "node:crypto";

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
