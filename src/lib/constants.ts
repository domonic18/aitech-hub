/** 跨模块领域常量(arch/00-overview 与 arch/06-project-structure:env 可调进 env.ts,领域常量在此,模块私有留模块顶部) */

/** 列表分页默认值(arch/07-frontend §4):12 = 卡片视图 1200 版心 4 列 × 3 行
 *  (minmax(280px,1fr) + gap-5),每页刚好排满;此前的 10 会让末行空两格、
 *  看着像「没有更多文章了」(2026-11-01 验收反馈) */
export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 50;

/** RSS 输出篇数(arch/07-frontend §3:最新 20 篇) */
export const RSS_FEED_SIZE = 20;

/** legacy_url_map 的 Redis 缓存秒数(arch/07-frontend §6:1h,miss 落库一次防穿透) */
export const LEGACY_CACHE_TTL_SECONDS = 3600;

/**
 * 统计域字段上限(2026-11-01 批D 收敛):此前同一上限在 Zod 入参、classify 截断、
 * service 落库 slice、schema VarChar 四处各写一遍。这里是对齐 schema 的唯一来源,
 * 改列宽先改这里再迁移;schema.prisma 对应列注释指向本文件。
 */
export const PATH_MAX = 500;
export const REFERRER_MAX = 2000;
export const SOURCE_NAME_MAX = 50;
/** 客户端字段(browser / os)上限 */
export const CLIENT_FIELD_MAX = 50;
export const DEVICE_TYPE_MAX = 20;
/** IP 原文列上限(VarChar(45),兼容 IPv6) */
export const IP_MAX = 45;
/** 搜索词原文上限(stats_search_log.term) */
export const SEARCH_TERM_MAX = 100;

/** 关于页内容 markdown 上限(空值回退内置默认文案,与 hero_md 同兜底模式)。
 *  住这里而非 lib/config/site-config:后者链到 prisma/env,而 admin 表单是客户端组件,
 *  只有纯常量可以进 client chunk(2026-11-01 站点设置页白屏事故,见 lib/site-meta 头注)。 */
export const ABOUT_MD_MAX = 8000;
