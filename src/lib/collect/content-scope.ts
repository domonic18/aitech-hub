/**
 * 内容类采集任务白名单(M69 /telegram 右栏「采集计划」):公开页只展示内容
 * 生产链路的计划与运行,运维/对账/清理/健康任务一律不露出。
 *
 * 用显式 jobKey 白名单而非按 category:
 * - insight 分类含 leaderboard-fx(市场汇率,非内容);
 * - process/ops 含支付对账、DB 备份、各类 purge、media-audit 等。
 * registry key 由 jobRunKey 反查,避免第二份手工映射漂移。
 *
 * 纯模块(仅 import 零 IO 的 schedules),客户端/服务端均可安全引用。
 */
import { SCHEDULE_REGISTRY } from "./schedules";

export const CONTENT_JOB_KEYS = [
  "crawler/crawl",
  "crawler/ai-backfill",
  "insight/fetch",
  "insight/daily",
  "insight/label",
  "insight/embed",
  "insight/translate",
  "discovery/discovery-hotwords",
  "discovery/discovery-bili",
] as const;

const CONTENT_JOB_KEY_SET: ReadonlySet<string> = new Set(CONTENT_JOB_KEYS);

export function isContentJobKey(key: string): boolean {
  return CONTENT_JOB_KEY_SET.has(key);
}

/** 登记表里属于内容链路的计划键(用于「即将运行」过滤) */
export const CONTENT_SCHEDULE_KEYS: readonly string[] = SCHEDULE_REGISTRY.filter(
  (d) => d.jobRunKey !== undefined && CONTENT_JOB_KEY_SET.has(d.jobRunKey),
).map((d) => d.key);

const CONTENT_SCHEDULE_KEY_SET: ReadonlySet<string> = new Set(CONTENT_SCHEDULE_KEYS);

export function isContentScheduleKey(key: string): boolean {
  return CONTENT_SCHEDULE_KEY_SET.has(key);
}
