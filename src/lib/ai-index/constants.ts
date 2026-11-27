/**
 * AI 智能指数域常量单源
 *
 * 上游入口、闸门阈值、聚合口径、同步滞后判定都在这里维护——别在各处散落
 * 硬编码(同一个「7 天」在读侧与健康域各写一遍,改一处就漂)。
 *
 * 口径见 docs/arch/03-data-model.md §2.4。
 */

/** 上游 Epoch ECI 分数(官方单发的 CSV;整包 zip 被上游限速,已弃用) */
export const ECI_CSV_URL = "https://epoch.ai/data/eci_scores.csv";
/** 上游许可(展示与种子文件元数据同用) */
export const ECI_LICENSE = "CC BY 4.0";
/** 请求 UA(标明身份,便于上游联系) */
export const ECI_USER_AGENT = "aitech-hub-ai-index/1.0 (+https://17aitech.com)";
/** 拉取超时 */
export const ECI_FETCH_TIMEOUT_MS = 120_000;
/** CSV 体积上限(防御异常大响应) */
export const ECI_CSV_MAX_BYTES = 8 * 1024 * 1024;

/** 闸门:模型行数上限 */
export const ECI_MAX_ROWS = 5000;
/** 闸门:模型行数下限(太少说明上游改版或抽风) */
export const ECI_MIN_ROWS = 50;
/** 闸门:ECI 分数取值区间 */
export const ECI_SCORE_MIN = 0;
export const ECI_SCORE_MAX = 1000;
/** 闸门:最早的合法基准日期 */
export const ECI_EARLIEST_DATE = "2020-01-01";
/** 闸门:相对上次,模型数跌幅超此比例判上游异常(只拒跌不拒涨) */
export const ECI_MODEL_COUNT_DROP_RATIO = 0.8;
/** 闸门:相对上次,前沿 ECI 跌幅超此比例判上游异常(只拒跌不拒涨) */
export const ECI_FRONTIER_DROP_RATIO = 0.9;

/** 能力层超过此天数没成功同步,判「滞后」(前台标记 + 健康域 warning) */
export const ECI_STALE_DAYS = 7;
/** 连续非 ok 拉取达此次数,判上游链路已挂(健康域 critical) */
export const ECI_CONSECUTIVE_FAILS = 3;

/** 参与打分的时间窗(天) */
export const AI_INDEX_SCORE_LOOKBACK_DAYS = 30;
/** 单轮取电报条数上限 */
export const AI_INDEX_SCORE_MAX_ITEMS = 500;
/** 单轮打分条数上限:worker 发版 30s 优雅停机会把长任务 SIGKILL,任务必须短;
 * 剩下的条目下一轮继续(台账幂等,kill 无副作用) */
export const AI_INDEX_SCORE_BATCH_LIMIT = 120;
/** 读评分台账的窗口(天):冲击分是滚动 180 天百分位,窗口内的历史要够 */
export const AI_INDEX_SERIES_READ_DAYS = 180;
/** 每轮重算 ai_index_daily 的天数(更早不回头) */
export const AI_INDEX_RECOMPUTE_DAYS = 30;
/** 智能指数 = 能力基线 + 冲击加成(上限 +PULSE_BONUS 分) */
export const AI_INDEX_PULSE_BONUS = 5;

/** 看板曲线默认取的天数 */
export const AI_INDEX_SERIES_DEFAULT_DAYS = 90;
/** 首页卡片取的天数 */
export const AI_INDEX_CARD_DAYS = 30;

/** 冷启动种子文件(仓库快照,表空时播种一次) */
export const AI_INDEX_SEED_FILE_PATH = "src/lib/ai-index/epoch-data.ts";
