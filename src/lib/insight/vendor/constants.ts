/**
 * 厂商事件层词表(M58 批②):事件类型/实体类型合法值与展示名。
 * 库列一律 String(arch/03 枚举演进条款),边界由 Zod 与 LLM 契约解析引用
 * 本表;后台筛选项与表格徽章同源自此。
 */

export const ENTITY_TYPE_MODEL = "model";
export const ENTITY_TYPE_PRODUCT = "product";
export const ENTITY_TYPE_ORG = "org";
export const ENTITY_TYPES = [ENTITY_TYPE_MODEL, ENTITY_TYPE_PRODUCT, ENTITY_TYPE_ORG] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  model: "模型",
  product: "产品",
  org: "组织",
};

export const EVENT_TYPE_RELEASE = "release";
export const EVENT_TYPE_PRICE_CHANGE = "price_change";
export const EVENT_TYPE_OPEN_SOURCE = "open_source";
export const EVENT_TYPE_FUNDING = "funding";
export const EVENT_TYPE_DEPRECATION = "deprecation";
export const EVENT_TYPE_BENCHMARK_CHANGE = "benchmark_change";
export const EVENT_TYPES = [
  EVENT_TYPE_RELEASE,
  EVENT_TYPE_PRICE_CHANGE,
  EVENT_TYPE_OPEN_SOURCE,
  EVENT_TYPE_FUNDING,
  EVENT_TYPE_DEPRECATION,
  EVENT_TYPE_BENCHMARK_CHANGE,
] as const;
export type EntityEventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EntityEventType, string> = {
  release: "发布",
  price_change: "调价",
  open_source: "开源",
  funding: "融资",
  deprecation: "下线",
  benchmark_change: "榜单变化",
};

/** 单篇文章最多抽取事件数(方案 §5.2:超过丢弃并计数) */
export const VENDOR_MAX_EVENTS_PER_ARTICLE = 3;

/** 事件时间合理区间下界(早于此视为模型幻觉/脏数据丢弃) */
export const EVENT_MIN_YEAR = 2000;

/** 事件原文取数上限(标题+摘要;不足此长度再抓正文,方案 §5.2 抽取输入) */
export const VENDOR_TEXT_MIN_FOR_FETCH = 200;
export const VENDOR_TEXT_MAX = 4000;

/** 已处理文章标记 TTL(秒):同文章 30 天内只抽取一次;抽取失败即释放,
 * 下一轮重试(偶发在途重复由 entity_event.dedupeKey 唯一索引兜底) */
export const VENDOR_SEEN_TTL_SEC = 30 * 24 * 3600;

export function isEntityType(v: unknown): v is EntityType {
  return typeof v === "string" && (ENTITY_TYPES as readonly string[]).includes(v);
}

export function isEntityEventType(v: unknown): v is EntityEventType {
  return typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v);
}
