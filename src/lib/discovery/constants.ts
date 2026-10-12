/**
 * 优质内容发现常量(M25,方案锚 docs/plan/discovery-plan.md):
 * 窗口/阈值/风控纪律间隔一处收敛,调度 cron 与 job name 在 lib/queue(全仓队列契约同址)。
 */

/** 单轮 active 词数上限,超出部分顺延下轮(按 updatedAt 最久未用优先轮转,防 job 时长失控) */
export const DISCOVERY_MAX_WORDS_PER_ROUND = 20;

/** 任务B 窗口一·找博主:90 天窗 */
export const DISCOVERY_BLOGGER_WINDOW_DAYS = 90;
/** 任务B 窗口二·找热点视频:7 天窗 */
export const DISCOVERY_VIDEO_WINDOW_DAYS = 7;

/** 每词取搜索首页条数(原型实证口径) */
export const DISCOVERY_SEARCH_PAGE_SIZE = 20;
/** 博主双排序取 top N(hitCount desc, maxPlay desc) */
export const DISCOVERY_BLOGGER_TOP_N = 20;
/** 热点视频播放达标线(≥5 万,常量可调) */
export const DISCOVERY_VIDEO_MIN_PLAY = 50_000;

/** v1 唯一平台标识(落 discovery_candidate.platform;v2 多平台扩展点) */
export const DISCOVERY_PLATFORM_BILIBILI = "bilibili";

// ── B站风控纪律间隔(§8 实证,固化必守;全部毫秒)──────────────

/** search 词间 6-9s 随机 */
export const BILI_SEARCH_GAP_MS: readonly [number, number] = [6_000, 9_000];
/** search 412 退避 15s 重试 ≤3,仍败该词跳过(不弃整轮) */
export const BILI_BACKOFF_412_MS = 15_000;
export const BILI_SEARCH_RETRY = 3;
/** search 全部完成后延迟再进 card 阶段(实证 search 连发后 session 整体进风控态,
 *  card 同级被拦 -352;拆阶段 + 冷却窗,保守 30s) */
export const BILI_CARD_PHASE_DELAY_MS = 30_000;
/** card 条间 3-4.2s 随机;失败不阻塞(fans/archives 留空) */
export const BILI_CARD_GAP_MS: readonly [number, number] = [3_000, 4_200];
/** 联想词轻接口词间 ≥3s(任务A) */
export const BILI_SUGGEST_GAP_MS: readonly [number, number] = [3_000, 4_200];
