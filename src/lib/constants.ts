/** 跨模块领域常量(00/01 文档:env 可调进 env.ts,领域常量在此,模块私有留模块顶部) */

/** 列表分页默认值(04 文档 §4:page/pageSize 默认值) */
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

/** RSS 输出篇数(04 文档 §3:最新 20 篇) */
export const RSS_FEED_SIZE = 20;

/** legacy_url_map 的 Redis 缓存秒数(04 文档 §6:1h,miss 落库一次防穿透) */
export const LEGACY_CACHE_TTL_SECONDS = 3600;
