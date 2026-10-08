/**
 * 三域检索视图模型与计分纯函数(K1,arch/04 §3.2):
 * 类型契约为 /search 结果页与 K2 答案卡引用上下文共用;计分/排序/映射零 IO,
 * 便于单测钉死权重与排序口径。BigInt 出口一律转 string(仓库纪律)。
 */
import { postPath } from "../content/post-path";
import { toEngagement } from "../telegram/feed-view";

export type SearchDomain = "telegram" | "post" | "repo";

interface SearchHitBase {
  /** string 形态 id(BigInt 出口转 string 纪律) */
  id: string;
  title: string;
  /** 展示摘要(aiSummary 优先;post=excerpt;repo=description,可空) */
  snippet: string;
  /** 条目落地链接(telegram/repo=外链原样;post=站内 /post/<id>-<slug>/) */
  href: string;
  /** 展示排序与「更新于」口径的 ISO 时间;null 仅防御 */
  dateIso: string | null;
  /** 命中度百分比(词项覆盖率,下限 1——SQL OR 已保证至少命中一处) */
  hitPct: number;
  /** 语义命中(M20 混合检索):词项零命中、向量召回;UI 以「语义」标替代百分比 */
  semanticOnly?: boolean;
}

export interface TelegramSearchHit extends SearchHitBase {
  domain: "telegram";
  sourceName: string;
  sourceType: string;
  mediaType: "text" | "video";
  video?: {
    platform: string;
    blogger: string;
    coverUrl: string | null;
    durationSeconds: number | null;
    engagement: { play: number | null; like: number | null; comment: number | null };
  };
  /** AI 解读结论(ai_summary;空行 null → 摘要回落 summary) */
  aiSummary: string | null;
}

export interface PostSearchHit extends SearchHitBase {
  domain: "post";
  viewsCount: number;
  tags: string[];
}

export interface RepoSearchHit extends SearchHitBase {
  domain: "repo";
  fullName: string;
  stars: number;
  language: string | null;
  topics: string[];
  postCount: number;
}

export type SearchHit = TelegramSearchHit | PostSearchHit | RepoSearchHit;

export interface SearchGroup {
  domain: SearchDomain;
  label: string;
  /** 组头 mono 计数标键(TELEGRAMS/ARTICLES/REPOS) */
  tagKey: string;
  /** 库内命中总数(findMany count,非展示条数) */
  total: number;
  items: SearchHit[];
  moreHref: string;
  moreLabel: string;
}

export interface UnifiedSearchResult {
  q: string;
  terms: string[];
  /** 三域命中总数之和(result-head「检索 N 条」) */
  total: number;
  groups: { telegram: SearchGroup; post: SearchGroup; repo: SearchGroup };
}

/** 计分字段桶:title 权重 3 > summary 2 > body 1(取向定稿) */
export interface ScoreFields {
  title: string;
  summary?: string | null;
  body?: string | null;
}

/** 词项加权命中:命中权重求和 + 覆盖率(命中词项数/总词项数;空词项覆盖率 0) */
export function scoreTerms(terms: string[], f: ScoreFields): { score: number; coverage: number } {
  const title = f.title.toLowerCase();
  const summary = (f.summary ?? "").toLowerCase();
  const body = (f.body ?? "").toLowerCase();
  let score = 0;
  let hits = 0;
  for (const t of terms) {
    const inTitle = title.includes(t);
    const inSummary = summary.includes(t);
    const inBody = body.includes(t);
    if (inTitle) score += 3;
    if (inSummary) score += 2;
    if (inBody) score += 1;
    if (inTitle || inSummary || inBody) hits += 1;
  }
  return { score, coverage: terms.length > 0 ? hits / terms.length : 0 };
}

/** 覆盖率 → 命中度百分比;下限 1(SQL OR 保证至少命中一处,正文/关键词等
 * 未入 JS 计分桶的命中以下限兜底,不出现「命中 0%」) */
export function hitPercent(coverage: number): number {
  return Math.max(1, Math.round(coverage * 100));
}

export interface RankedFields {
  id: string;
  dateIso: string | null;
}

/**
 * 候选行重排后截断:score desc → dateIso desc(null 按 0)→ id 数值 desc tiebreak
 * (BigInt 串字典序跨位数失真,转 BigInt 比对);挂 hitPct 后取前 limit 条。
 */
export function rankAndCut<T>(
  rows: T[],
  terms: string[],
  limit: number,
  fieldOf: (r: T) => ScoreFields & RankedFields,
): Array<T & { hitPct: number }> {
  const scored = rows.map((row) => {
    const f = fieldOf(row);
    const { score, coverage } = scoreTerms(terms, f);
    return { row, score, coverage, date: f.dateIso ? Date.parse(f.dateIso) : 0, id: f.id };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.date !== a.date) return b.date - a.date;
    return BigInt(b.id) >= BigInt(a.id) ? 1 : -1;
  });
  return scored
    .slice(0, limit)
    .map(({ row, coverage }) => ({ ...row, hitPct: hitPercent(coverage) }));
}

/** 每域向量召回条数上限(M20;HNSW 近邻,与词项候选独立取前 N) */
export const VECTOR_RECALL_LIMIT = 30;

/** RRF 常数 k(论文原值;越大排名差对分数影响越平缓) */
export const RRF_K = 60;

/** 融合候选项(词项/向量双榜排名 + 词法证据 tiebreak 字段) */
export interface FusedCandidate {
  id: string;
  /** 词项榜排名(0 起;null=纯语义,不在词项候选中) */
  kwRank: number | null;
  /** 向量榜排名(0 起;null=向量层未命中) */
  vecRank: number | null;
  /** 词项计分分(scoreTerms.score;词法证据优先 tiebreak) */
  kwScore: number;
  date: number;
}

/** 单条 RRF 分数:双榜贡献取和,单榜命中只计一榜(降级时严格随排名递减) */
export function rrfScore(c: FusedCandidate, k: number = RRF_K): number {
  const kw = c.kwRank === null ? 0 : 1 / (k + c.kwRank + 1);
  const vec = c.vecRank === null ? 0 : 1 / (k + c.vecRank + 1);
  return kw + vec;
}

/**
 * 融合排序比较器:RRF 降序;同分 tiebreak 词法证据(kwScore)优先 → 日期 →
 * id 数值 desc(与 rankAndCut 同口径)。RRF 同分的典型形态是「词项榜 rank n 的
 * 单榜命中 vs 向量榜 rank n 的纯语义命中」——字面实词命中更可能是用户所指,置前。
 */
export function fuseCompare(a: FusedCandidate, b: FusedCandidate, k: number = RRF_K): number {
  const diff = rrfScore(b, k) - rrfScore(a, k);
  if (diff !== 0) return diff;
  if (b.kwScore !== a.kwScore) return b.kwScore - a.kwScore;
  if (b.date !== a.date) return b.date - a.date;
  return BigInt(b.id) >= BigInt(a.id) ? 1 : -1;
}

export type TelegramRow = {
  id: bigint;
  title: string | null;
  summary: string;
  url: string;
  publishedAt: Date | null;
  createdAt: Date;
  mediaType: string;
  videoPlatform: string | null;
  videoBlogger: string | null;
  videoCoverUrl: string | null;
  videoDuration: number | null;
  videoEngagement: unknown;
  aiTopic: string | null;
  aiSummary: string | null;
  aiKeywords: unknown;
  source: { name: string; type: string };
};

/** telegram 行 → 命中视图(aiSummary 展示优先;topic/keywords 并入摘要桶计分) */
export function toTelegramHit(row: TelegramRow & { hitPct: number }): TelegramSearchHit {
  const mediaType = row.mediaType === "video" ? "video" : "text";
  return {
    domain: "telegram",
    id: row.id.toString(),
    title: row.title ?? row.summary.slice(0, 80),
    snippet: row.aiSummary?.trim() ? row.aiSummary : row.summary,
    href: row.url,
    dateIso: (row.publishedAt ?? row.createdAt).toISOString(),
    hitPct: row.hitPct,
    sourceName: row.source.name,
    sourceType: row.source.type,
    mediaType,
    ...(mediaType === "video"
      ? {
          video: {
            platform: row.videoPlatform ?? "",
            blogger: row.videoBlogger ?? "",
            coverUrl: row.videoCoverUrl,
            durationSeconds: row.videoDuration,
            engagement: toEngagement(row.videoEngagement),
          },
        }
      : {}),
    aiSummary: row.aiSummary?.trim() ? row.aiSummary : null,
  };
}

/** telegram 行的 JS 计分字段(topic/keywords 并入摘要桶;SQL where 同域) */
export function telegramScoreFields(row: TelegramRow): ScoreFields {
  const keywordStr = Array.isArray(row.aiKeywords)
    ? row.aiKeywords.filter((k): k is string => typeof k === "string").join(" ")
    : "";
  return {
    title: row.title ?? "",
    summary: [row.summary, row.aiSummary ?? "", row.aiTopic ?? "", keywordStr]
      .filter(Boolean)
      .join(" "),
  };
}

export type PostRow = {
  id: bigint;
  slug: string | null;
  title: string;
  excerpt: string | null;
  viewsCount: bigint;
  publishedAt: Date | null;
  tags: Array<{ tag: { name: string } }>;
};

/** 文章行 → 命中视图(站内链接唯一出口 postPath;publishedAt 恒有值) */
export function toPostHit(row: PostRow & { hitPct: number }): PostSearchHit {
  return {
    domain: "post",
    id: row.id.toString(),
    title: row.title,
    snippet: row.excerpt ?? "",
    href: postPath(row.id, row.slug),
    dateIso: row.publishedAt ? row.publishedAt.toISOString() : null,
    hitPct: row.hitPct,
    viewsCount: Number(row.viewsCount),
    tags: row.tags.map((t) => t.tag.name),
  };
}

export function postScoreFields(row: PostRow): ScoreFields {
  return { title: row.title, summary: row.excerpt ?? "" };
}

export type RepoRow = {
  id: number;
  fullName: string;
  description: string | null;
  stars: number;
  language: string | null;
  topics: string[];
  htmlUrl: string;
  updatedAt: Date;
  _count: { posts: number };
};

/** 仓库行 → 命中视图(外链 htmlUrl;topics 并入摘要桶计分) */
export function toRepoHit(row: RepoRow & { hitPct: number }): RepoSearchHit {
  return {
    domain: "repo",
    id: String(row.id),
    title: row.fullName,
    snippet: row.description ?? "",
    href: row.htmlUrl,
    dateIso: row.updatedAt.toISOString(),
    hitPct: row.hitPct,
    fullName: row.fullName,
    stars: row.stars,
    language: row.language,
    topics: row.topics,
    postCount: row._count.posts,
  };
}

export function repoScoreFields(row: RepoRow): ScoreFields {
  return {
    title: row.fullName,
    summary: [row.description ?? "", row.topics.join(" ")].filter(Boolean).join(" "),
  };
}
