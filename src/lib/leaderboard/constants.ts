/**
 * 榜单域词表(M58 批③):榜单 key/实体类型/上限等纯常量。
 * 库列一律 String(arch/03 枚举演进条款),边界由注册表与 Zod 收口;
 * 后台台账与公开页展示名同源自此,防两处漂移。
 */

/** 实体类型(方案 §3 leaderboard_snapshot.entityType) */
export const LEADERBOARD_ENTITY_MODEL = "model";
export const LEADERBOARD_ENTITY_PAPER = "paper";
export const LEADERBOARD_ENTITY_REPO = "repo";
export const LEADERBOARD_ENTITY_TYPES = [
  LEADERBOARD_ENTITY_MODEL,
  LEADERBOARD_ENTITY_PAPER,
  LEADERBOARD_ENTITY_REPO,
] as const;
export type LeaderboardEntityType = (typeof LEADERBOARD_ENTITY_TYPES)[number];

export const LEADERBOARD_ENTITY_LABELS: Record<LeaderboardEntityType, string> = {
  model: "模型",
  paper: "论文",
  repo: "仓库",
};

/** 单榜单轮入榜条目上限(只存前 N 名;读侧不做分页) */
export const LEADERBOARD_MAX_ITEMS = 20;

/** 公开页榜单展示名(键=注册表 key) */
export const LEADERBOARD_SOURCE_LABELS: Record<string, string> = {
  "artificial-analysis": "Artificial Analysis",
  huggingface: "Hugging Face",
  "arxiv-cs-ai": "arXiv cs.AI",
  "arxiv-cs-cl": "arXiv cs.CL",
  github: "GitHub Trending",
};

/** 来源署名(公开页底部,转载合规:逐源标注原始出处) */
export const LEADERBOARD_SOURCE_URLS: Record<string, string> = {
  "artificial-analysis": "https://artificialanalysis.ai/leaderboards/models",
  huggingface: "https://huggingface.co/models?sort=trending",
  "arxiv-cs-ai": "https://arxiv.org/list/cs.AI/recent",
  "arxiv-cs-cl": "https://arxiv.org/list/cs.CL/recent",
  github: "https://github.com/trending",
};
