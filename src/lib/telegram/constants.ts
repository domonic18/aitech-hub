/**
 * 电报流/采集域常量(M7,arch/02):合法值单一出处,零依赖。
 * 库列一律 String(arch/03 枚举演进条款),边界经 zod 引用此处约束。
 */

export const CRAWL_SOURCE_TYPE_RSS = "rss";
export const CRAWL_SOURCE_TYPE_WEB = "web";
export const CRAWL_SOURCE_TYPE_API = "api";
export const CRAWL_SOURCE_TYPE_SOCIAL_VIDEO = "social-video";
export const CRAWL_SOURCE_TYPES = [
  CRAWL_SOURCE_TYPE_RSS,
  CRAWL_SOURCE_TYPE_WEB,
  CRAWL_SOURCE_TYPE_API,
  CRAWL_SOURCE_TYPE_SOCIAL_VIDEO,
] as const;
export type CrawlSourceType = (typeof CRAWL_SOURCE_TYPES)[number];

export const CRAWL_SOURCE_STATUS_HEALTHY = "healthy";
export const CRAWL_SOURCE_STATUS_DEGRADED = "degraded";
export const CRAWL_SOURCE_STATUS_ERROR = "error";

/** 电报媒体类型(M8 混合流,arch/02 §2):视频字段组仅 media_type=video 时有值 */
export const TELEGRAM_MEDIA_TEXT = "text";
export const TELEGRAM_MEDIA_VIDEO = "video";
export const TELEGRAM_MEDIA_TYPES = [TELEGRAM_MEDIA_TEXT, TELEGRAM_MEDIA_VIDEO] as const;
export type TelegramMediaType = (typeof TELEGRAM_MEDIA_TYPES)[number];

/** 视频平台(M8 抖音首批;adapter 按 platform 分发,B站后补仅新增实现) */
export const VIDEO_PLATFORM_DOUYIN = "douyin";
export const VIDEO_PLATFORM_XHS = "xhs";
export const VIDEO_PLATFORM_BILIBILI = "bilibili";
export const VIDEO_PLATFORMS = [
  VIDEO_PLATFORM_DOUYIN,
  VIDEO_PLATFORM_XHS,
  VIDEO_PLATFORM_BILIBILI,
] as const;
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

/** 平台行 crawl_source.name(1 平台 1 行;Cookie 池/总开关/日上限载体) */
export function socialPlatformRowName(platform: string): string {
  return `social:${platform}`;
}

/** 博主轮询间隔下限(arch/02 §3.2:listing 轮询 ≥120min) */
export const SOCIAL_CRAWL_INTERVAL_MIN = 120;
/** 博主连续失败阈值(语义同渠道侧 ≥3 → 观测降级;写 last_error 供博主台账) */
export const SOCIAL_MAX_CONSECUTIVE_FAILS = 3;
/** 首采回填窗口(天)与条数上限:防新登记博主刷屏(arch/02 §3.2 shell 降级可见) */
export const SOCIAL_BACKFILL_DAYS = 7;
export const SOCIAL_BACKFILL_MAX_ITEMS = 10;

export const TELEGRAM_STATUS_VISIBLE = "visible";
export const TELEGRAM_STATUS_HIDDEN = "hidden";
export const TELEGRAM_STATUS_ARCHIVED = "archived";
export const TELEGRAM_STATUS_DELETED = "deleted";
export const TELEGRAM_STATUSES = [
  TELEGRAM_STATUS_VISIBLE,
  TELEGRAM_STATUS_HIDDEN,
  TELEGRAM_STATUS_ARCHIVED,
  TELEGRAM_STATUS_DELETED,
] as const;
export type TelegramStatus = (typeof TELEGRAM_STATUSES)[number];

export const BLOCKLIST_SCOPE_TITLE = "title";
export const BLOCKLIST_SCOPE_SUMMARY = "summary";
export const BLOCKLIST_SCOPE_ALL = "all";
export const BLOCKLIST_SCOPES = [
  BLOCKLIST_SCOPE_TITLE,
  BLOCKLIST_SCOPE_SUMMARY,
  BLOCKLIST_SCOPE_ALL,
] as const;
export type BlocklistScope = (typeof BLOCKLIST_SCOPES)[number];

/** 连续失败阈值(arch/02 §3.1:≥3 → source.status=error) */
export const CRAWL_MAX_CONSECUTIVE_FAILS = 3;

/** 单来源单轮入库上限(防异常 feed 撑爆单轮;适配器返回再多也截断) */
export const CRAWL_MAX_ITEMS_PER_RUN = 50;
