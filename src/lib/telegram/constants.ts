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

/** 平台展示名(feed-view 投影角标用;未知平台回退原值) */
export const VIDEO_PLATFORM_LABELS: Record<string, string> = {
  [VIDEO_PLATFORM_DOUYIN]: "抖音",
  [VIDEO_PLATFORM_XHS]: "小红书",
  [VIDEO_PLATFORM_BILIBILI]: "B站",
};

/** 博主轮询间隔下限(arch/02 §3.2:listing 轮询 ≥120min) */
export const SOCIAL_CRAWL_INTERVAL_MIN = 120;
/** 博主连续失败阈值(语义同渠道侧 ≥3 → 观测降级;写 last_error 供博主台账) */
export const SOCIAL_MAX_CONSECUTIVE_FAILS = 3;
/** 首采回填窗口(天)与条数上限:防新登记博主刷屏(arch/02 §3.2 shell 降级可见) */
export const SOCIAL_BACKFILL_DAYS = 7;
export const SOCIAL_BACKFILL_MAX_ITEMS = 10;
/** 手动回填窗口(天,批⑧「回填」ops):比首采 7 天窗宽,不设条数帽(maxPages=3 深扫) */
export const SOCIAL_MANUAL_BACKFILL_DAYS = 30;
/** 手动回填单轮翻页上限(编排层口径;适配器按各自网关上限自行钳制) */
export const SOCIAL_BACKFILL_MAX_PAGES = 3;

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

/** 解读态(M9,telegram.ai_status;null=未解读):入队 pending → processing → 终态 */
export const TELEGRAM_AI_PENDING = "pending";
export const TELEGRAM_AI_PROCESSING = "processing";
export const TELEGRAM_AI_DONE = "done";
/** ASR 终败降级:无转写,LLM 仅基于文案元数据概括(仍落 ai_* 列) */
export const TELEGRAM_AI_MISSING_TRANSCRIPT = "missing_transcript";
export const TELEGRAM_AI_FAILED = "failed";
export const TELEGRAM_AI_TERMINAL = [TELEGRAM_AI_DONE, TELEGRAM_AI_MISSING_TRANSCRIPT] as const;

/** 解读态展示名(治理台徽章/统计共用;null=未解读由 UI 兜底,不入表) */
export const AI_STATUS_LABELS: Record<string, string> = {
  [TELEGRAM_AI_PENDING]: "排队中",
  [TELEGRAM_AI_PROCESSING]: "解读中",
  [TELEGRAM_AI_DONE]: "已解读",
  [TELEGRAM_AI_MISSING_TRANSCRIPT]: "无转写 · 文案概括",
  [TELEGRAM_AI_FAILED]: "失败",
};

/** lastAiError 落库截断宽度(= schema VarChar(500),写入侧唯一出处) */
export const TELEGRAM_AI_ERROR_MAX = 500;

/** 电报条目 id 合法形态(BigInt ≤ 19 位;治理 API 路由段唯一校验出处) */
export const TELEGRAM_ID_RE = /^\d{1,19}$/;

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

// ── 首页 LIVE 带条数(M10 批②;site_config band.item_count 的合法域) ──────────

/** 配置缺行/构建期无库/库值非数时的兜底(SSR 初值与 60s 轮询同源) */
export const DEFAULT_BAND_ITEM_COUNT = 12;
export const BAND_ITEM_COUNT_MIN = 1;
export const BAND_ITEM_COUNT_MAX = 50;

/** 越界/非数回落默认值后 clamp 到合法域(配置读侧与带取数共用,防两侧口径漂移) */
export function clampBandItemCount(n: number): number {
  return Math.min(
    Math.max(Math.trunc(n) || DEFAULT_BAND_ITEM_COUNT, BAND_ITEM_COUNT_MIN),
    BAND_ITEM_COUNT_MAX,
  );
}
