/**
 * 统计域 Redis 键的唯一出口(2026-11-01 批C 收口)。
 *
 * 此前键形逐字散在 service.ts / flush.ts / online.ts:写侧用模板串拼,flush 侧再从
 * `key.split(":")` 的下标反解 kind/day/metric —— 同一份契约写了两遍,靠人眼对齐,
 * 改任一侧只有跑到线上、缓冲落错表时才发现对不上。
 *
 * 本文件把「构造」与「解析」并排放,两侧共用同一份段序:
 *  - bufferKey / parseBufferKey:解析返回判别联合,而不是让调用方数下标;
 *  - 各键的存活时长与键形写在一起(flush 的私有暂存键复用 BUFFER_TTL_SECONDS),
 *    不再出现「这个键该活多久」在两个文件里各说一遍。
 */

/** 日缓冲键兜底过期:worker 长期不可用时防无限堆积;私有暂存键同值 */
export const BUFFER_TTL_SECONDS = 172800;

const BUF_PREFIX = "stats:buf:";

export type BufferKind = "visit" | "ref" | "page" | "client" | "post" | "geo";
export type PageMetric = "pv" | "uv";

const BUFFER_KINDS: readonly BufferKind[] = ["visit", "ref", "page", "client", "post", "geo"];
const PAGE_METRICS: readonly PageMetric[] = ["pv", "uv"];

/**
 * 日缓冲键:`stats:buf:<kind>:<day>`,page 再带 `:pv|uv` 分键。
 * 重载把「page 必须给 metric、其余不许给」编进类型——写错是编译期错误,
 * 不在 beacon 热路径上抛运行时异常。
 */
export function bufferKey(kind: "page", day: string, metric: PageMetric): string;
export function bufferKey(kind: Exclude<BufferKind, "page">, day: string): string;
export function bufferKey(kind: BufferKind, day: string, metric?: PageMetric): string {
  return metric ? `${BUF_PREFIX}${kind}:${day}:${metric}` : `${BUF_PREFIX}${kind}:${day}`;
}

/** flush 遍历日缓冲用的 SCAN 模式 */
export const BUFFER_SCAN_MATCH = `${BUF_PREFIX}*`;

export type BufferDescriptor =
  | { kind: "visit" | "ref" | "client" | "post" | "geo"; day: string }
  | { kind: "page"; day: string; metric: PageMetric };

/**
 * 反向解析缓冲键;非缓冲键或段数/取值不合契约返回 null(调用方按「不认识」跳过)。
 * 宁可跳过也不猜:畸形键猜成 uv 会把 PV 计进 UV,静默污染日表。
 */
export function parseBufferKey(key: string): BufferDescriptor | null {
  if (!key.startsWith(BUF_PREFIX)) return null;
  const [kind, day, metric, ...extra] = key.slice(BUF_PREFIX.length).split(":");
  if (!kind || !day || extra.length > 0) return null;
  if (!(BUFFER_KINDS as readonly string[]).includes(kind)) return null;
  if (kind === "page") {
    return metric !== undefined && (PAGE_METRICS as readonly string[]).includes(metric)
      ? { kind: "page", day, metric: metric as PageMetric }
      : null;
  }
  // 非 page 键不应带第三段:带了的属于未知形态,跳过而非按某类落表
  return metric === undefined ? ({ kind, day } as BufferDescriptor) : null;
}

// ── 去重标记与解析缓存 ────────────────────────────────────────────────

/** 站点/页面日 UV 去重标记存活时长(当日有效) */
export const UV_DEDUP_TTL_SECONDS = 86400;

export function visitorDedupKey(day: string, vhash: string): string {
  return `stats:uv:${day}:${vhash}`;
}

export function pageVisitorDedupKey(day: string, vhash: string, pathHash: string): string {
  return `stats:uvp:${day}:${vhash}:${pathHash}`;
}

/** 文章阅读去重窗口(arch/05-services:IP+UA 1h) */
export const POST_DEDUP_TTL_SECONDS = 3600;

export function postViewDedupKey(day: string, vhash: string, postId: string): string {
  return `stats:pvp:${day}:${vhash}:${postId}`;
}

/** id→发布态解析缓存存活时长(含负缓存 "0") */
export const POSTMAP_TTL_SECONDS = 3600;

export function postLiveKey(postId: string): string {
  return `stats:postmap:${postId}`;
}

// ── 其它 ────────────────────────────────────────────────────────────

/** 在线用户 presence ZSET(5 分钟滑窗,online.ts) */
export const ONLINE_KEY = "stats:online";

/** presence 键兜底 TTL(窗口清理常态生效;长期无流量时靠它自清) */
export const ONLINE_KEY_TTL_SECONDS = 86_400;

/** flush 私有暂存键;token 由调用方生成,保证同键并发不撞 */
export function flushingKey(token: string, key: string): string {
  return `stats:flushing:${token}:${key}`;
}
