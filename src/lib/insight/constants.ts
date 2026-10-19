/**
 * 洞察加工层常量(M34 批②,方案 docs/plan/insight-plan.md §5):聚类/打标/
 * 覆盖度/评分/流转参数。取值=上线起点,批② 实测后按簇内聚度调参(方案 §9-5
 * 簇流转阈值实测定参同此);改值即发版,配置化留实测证据后另批。
 */
import type { InsightSource } from "./ingest";

/** 信号源 → 簇别初始引导值(批③ 验收三轮·痛点扩围:kind 不再按源定生死)。
 * 聚类已单池归簇(近邻跨 kind),此处映射仅作新建簇的引导值,LLM 打标日批
 * 按簇内容语义覆判 hot|pain(label.ts 契约);新源仍须在此登记(未登记源
 * 不入簇,见 cluster.ts 未知源分支) */
export const INSIGHT_SOURCE_KIND: Record<InsightSource, "hot" | "pain"> = {
  "internal-search": "pain",
  "internal-agent": "pain",
  "internal-comment": "pain",
  "internal-feedback": "pain",
  "telegram-ai": "hot",
  "hot-baidu": "hot",
  "hot-zhihu": "hot",
  "hot-bilibili": "hot",
};

/** 归簇余弦距离阈值:信号与既有簇成员最近向量的距离 ≤ 阈值即归簇,否则建新簇
 * (embedding-3 中文短文本实测起点;上线后按簇内聚度调参) */
export const CLUSTER_MATCH_DISTANCE = 0.35;

/** 参与聚类的最短归一文本长度(过短无语义区分度,如「ai」「怎么」;留原始
 * 信号行,只是不入簇) */
export const CLUSTER_MIN_TEXT_LEN = 4;

/** 单轮 embed/聚类批处理条数上限(embed job 每轮;存量回填多轮收敛,同
 * EMBED_RECONCILE_BATCH 取向) */
export const CLUSTER_BATCH_SIZE = 200;

/** 打标最小成员数(不足暂不打标——噪声簇等长起来再归纳,省 LLM 调用) */
export const LABEL_MIN_MEMBERS = 3;

/** 单次日批最多打标簇数(方案 §5.4 预估 10-30 次 LLM 调用/日,上限兜底防爆量) */
export const LABEL_BATCH_SIZE = 24;

/** 打标样本条数(最近成员优先,防 prompt 爆量;rawText 截断在此之上) */
export const LABEL_SAMPLE_SIZE = 12;

/** 打标样本单条截断长度(rawText 原文入 prompt 前截断) */
export const LABEL_SAMPLE_TEXT_MAX = 200;

/** fading 兜底:N 天无新成员自动降 fading(active→fading 单向,阈值实测调参,
 * 方案 §9-5;closed 只留人工) */
export const FADE_AFTER_DAYS = 14;

/** 异动告警(方案 §5.5):当日快照分 ≥ 前 3 日均值的 ANOMALY_RATIO 倍且
 * 绝对增量 ≥ ANOMALY_MIN_SCORE(双门防低基数假告警;读侧计算不落库) */
export const ANOMALY_RATIO = 3;
export const ANOMALY_MIN_SCORE = 10;

/** 覆盖度匹配(方案 §5.6):簇质心对 content_post 向量近邻召回条数 */
export const COVERAGE_TOPK = 20;

/** 覆盖近邻算命中的余弦距离上限(与归簇阈值同源口径) */
export const COVERAGE_MATCH_DISTANCE = 0.35;

/** 命中条数饱和值(≥3 篇即视为有内容面) */
export const COVERAGE_SATURATION = 3;

/** 覆盖档位(痛点卡空白标红=选题机会):covered ≥ COVERAGE_COVERED /
 * partial ≥ COVERAGE_PARTIAL / 其余 blank */
export const COVERAGE_COVERED = 0.5;
export const COVERAGE_PARTIAL = 0.15;

/** 机会评分卡(方案 §2 按留痕介质数加权;0-100 三项 40/30/30):
 * 介质广度 min(介质数,5)/5×40 + 近 7 日新增热度 min(新增,10)/10×30
 * + 内容空白 (1-覆盖度)×30(未算覆盖度的簇空白项按满额,促日批尽快回写) */
export const SCORE_MEDIA_WEIGHT = 40;
export const SCORE_HEAT_WEIGHT = 30;
export const SCORE_GAP_WEIGHT = 30;
export const SCORE_MEDIA_MAX = 5;
export const SCORE_HEAT_SATURATION = 10;
export const SCORE_HEAT_WINDOW_DAYS = 7;

/** 热榜拉取(批③):单源 HTTP 超时与单源入池条数上限(榜单截前 N,防长尾) */
export const HOTLIST_FETCH_TIMEOUT_MS = 10_000;
export const HOTLIST_MAX_ITEMS = 50;
