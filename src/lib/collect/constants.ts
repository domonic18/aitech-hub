/**
 * 采集渠道域常量(M56 批B 自 telegram/constants 上收:牌价/视频/文字渠道
 * 与 telegram 域解耦,channel-ledger/pricing 等跨域消费方统一引此处;
 * 零依赖纯常量,客户端组件可安全引用)。合法值单一出处,库列一律 String
 * (arch/03 枚举演进条款),边界经 zod 引用此处约束。
 */

export const CRAWL_SOURCE_TYPE_RSS = "rss";
export const CRAWL_SOURCE_TYPE_WEB = "web";
export const CRAWL_SOURCE_TYPE_API = "api";
export const CRAWL_SOURCE_TYPE_SOCIAL_VIDEO = "social-video";
export const CRAWL_SOURCE_TYPE_PRICING = "pricing";
/** 厂商动态(M58 批②):config.vendorKey 路由 insight/vendor/registry 的
 * 官方发布源(rss/html/sitemap 三种取数形态),条目走事件抽取而非电报入库 */
export const CRAWL_SOURCE_TYPE_VENDOR = "vendor";
export const CRAWL_SOURCE_TYPES = [
  CRAWL_SOURCE_TYPE_RSS,
  CRAWL_SOURCE_TYPE_WEB,
  CRAWL_SOURCE_TYPE_API,
  CRAWL_SOURCE_TYPE_SOCIAL_VIDEO,
  CRAWL_SOURCE_TYPE_PRICING,
  CRAWL_SOURCE_TYPE_VENDOR,
] as const;
export type CrawlSourceType = (typeof CRAWL_SOURCE_TYPES)[number];

/** 已实现采集管线的类型(M48 批E:adapters 仅 rss,web/api 建了必「适配器未实现」
 * 每轮报错;social-video 走博主采集管线,pricing 走牌价解析器路由 M56 批B,
 * vendor 走厂商注册表路由 M58 批②)——渠道创建/编辑 Zod 与 UI 选项一律用本清单,
 * 全集 CRAWL_SOURCE_TYPES 仅保留类型语义 */
export const CRAWL_SOURCE_TYPES_IMPLEMENTED = [
  CRAWL_SOURCE_TYPE_RSS,
  CRAWL_SOURCE_TYPE_SOCIAL_VIDEO,
  CRAWL_SOURCE_TYPE_PRICING,
  CRAWL_SOURCE_TYPE_VENDOR,
] as const;

export const CRAWL_SOURCE_STATUS_HEALTHY = "healthy";
export const CRAWL_SOURCE_STATUS_DEGRADED = "degraded";
export const CRAWL_SOURCE_STATUS_ERROR = "error";

/** 渠道连续失败阈值(crawler 侧 ≥N → status=error;台账 pill 同引此常量,M56 review P2-3) */
export const CRAWL_MAX_CONSECUTIVE_FAILS = 3;

/** 牌价渠道默认采集周期(周级:官方牌价页礼貌采集;源管理可调,M56 批B) */
export const PRICING_CRAWL_INTERVAL_MIN = 10_080;

/** 厂商动态默认采集周期(半日一次,每日 2 轮;官方博客发布频率低,礼貌采集,
 * 源管理可调,M58 批②) */
export const VENDOR_CRAWL_INTERVAL_MIN = 720;

/** 每源保留的快照份数(P0 回溯档案;采集后按时间倒序清理,COS 生命周期兜底) */
export const SNAPSHOT_KEEP_PER_SOURCE = 20;

/** 快照解析状态合法值(库列 String,边界 Zod 引用) */
export const SNAPSHOT_PARSE_PENDING = "pending";
export const SNAPSHOT_PARSE_SUCCESS = "success";
export const SNAPSHOT_PARSE_FAILED = "failed";
export const SNAPSHOT_PARSE_EMPTY = "empty";
export type SnapshotParseStatus =
  | typeof SNAPSHOT_PARSE_PENDING
  | typeof SNAPSHOT_PARSE_SUCCESS
  | typeof SNAPSHOT_PARSE_FAILED
  | typeof SNAPSHOT_PARSE_EMPTY;
