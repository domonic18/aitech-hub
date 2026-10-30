/**
 * 社区需求语料常量(M58 批④,data-expansion-plan §7)。日增预算与抓取口径
 * 集中于此:改值即发版;源级频率/仓库白名单等运行参数归 crawl_source.config
 * 后台可调,不进本文件。
 */

/** 单源每日入池预算(HN/V2EX 各 ≤200,其余 ≤50;超预算当轮截断,次日照常) */
export const COMMUNITY_DAILY_CAPS = {
  hn: 200,
  v2ex: 200,
  baidu: 50,
  oss: 50,
} as const;

export type CommunityKey = keyof typeof COMMUNITY_DAILY_CAPS;

/** 百度下拉种子上限(每次采集最多 N 个种子 × 每种子 10 条候选) */
export const COMMUNITY_BAIDU_MAX_SEEDS = 5;

/** 百度下拉站点标签兜底种子(标签库为空时使用) */
export const COMMUNITY_BAIDU_FALLBACK_SEEDS = ["AI 编程", "AI 工具", "AI 模型"];

/** 百度下拉取自站点标签的条数 */
export const COMMUNITY_BAIDU_TAG_SEEDS = 3;

/** 百度下拉取自近期热搜词的条数(发现热词回路) */
export const COMMUNITY_BAIDU_HOT_SEEDS = 2;

/** 百度下拉热词回看窗口 */
export const COMMUNITY_BAIDU_HOT_WINDOW_MS = 48 * 3_600_000;

/** GitHub Issues 白名单兜底(后台 config.repos 可增删,零发版) */
export const COMMUNITY_OSS_DEFAULT_REPOS = ["farion1231/cc-switch", "chenhg5/cc-connect"];

/** 单轮最多仓库数(每仓一次 API 请求,匿名限频 60 次/小时) */
export const COMMUNITY_OSS_MAX_REPOS = 5;

/** 只收近 N 天内新开的 issue(超出视为旧账,不重复入池) */
export const COMMUNITY_OSS_WINDOW_DAYS = 90;

/** issue 正文截断长度(标题 + 正文,超出丢弃;方案 §7) */
export const COMMUNITY_OSS_BODY_MAX = 2000;

/** V2EX 采集节点(实测 2026-10-30:openai/claude/deepseek/gemini 节点存在) */
export const COMMUNITY_V2EX_NODES = ["openai", "claude", "deepseek", "gemini"];

/** 百度下拉响应编码(实测 GB18030;Node TextDecoder 支持 gb18030) */
export const COMMUNITY_BAIDU_CHARSET = "gb18030";
