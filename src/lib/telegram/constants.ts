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
