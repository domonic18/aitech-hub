/**
 * 榜单快照 meta 载荷(M63):解析器多取的展示字段统一落
 * insight_leaderboard_snapshot.meta(Json?,无 schema 变更),公开页读侧经
 * readSnapshotMeta 宽容清洗后再用——历史行只有 {url, sourceId},必须退化为
 * 空 extra 而不是报错;上游载荷改版时也只丢展示字段,不让榜变空。
 *
 * 写侧唯一出口 snapshotMeta:create 与 update 必须写同一份(同日重采才会刷新
 * 价格/摘要等新字段);`undefined` 键一律剔除(Prisma JSON 入参不吃 undefined)。
 */

export interface LeaderboardItemMeta {
  /** Artificial Analysis:USD / 1M tokens */
  price1mOutputTokens?: number;
  price1mInputTokens?: number;
  contextWindowTokens?: number;
  isOpenWeights?: boolean;
  isReasoning?: boolean;
  /** Hugging Face */
  downloads?: number;
  likes?: number;
  pipelineTag?: string;
  /** arXiv */
  summary?: string;
  authors?: string[];
  /** YYYY-MM-DD */
  publishedAt?: string;
  categories?: string[];
  /** GitHub Trending */
  description?: string;
  language?: string;
  stars?: number;
  forks?: number;
}

/** 摘要/描述截断上限(快照每日一行,防单条把 meta 撑大) */
export const META_SUMMARY_MAX = 800;
export const META_DESCRIPTION_MAX = 300;
export const META_AUTHORS_MAX = 12;
export const META_CATEGORIES_MAX = 6;

const NUMERIC_KEYS = [
  "price1mOutputTokens",
  "price1mInputTokens",
  "contextWindowTokens",
  "downloads",
  "likes",
  "stars",
  "forks",
] as const;
const BOOLEAN_KEYS = ["isOpenWeights", "isReasoning"] as const;
const STRING_KEYS = ["pipelineTag", "publishedAt", "language"] as const;

function nonNeg(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (trimmed === "") return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function textList(v: unknown, max: number, itemMax: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const entry of v) {
    const t = text(entry, itemMax);
    if (t !== undefined && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out.length === 0 ? undefined : out;
}

/** 已知字段白名单清洗(写/读共用);全空返回 undefined */
export function normalizeExtra(raw: unknown): LeaderboardItemMeta | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: LeaderboardItemMeta = {};
  for (const key of NUMERIC_KEYS) {
    const n = nonNeg(src[key]);
    if (n !== undefined) out[key] = n;
  }
  for (const key of BOOLEAN_KEYS) {
    const b = src[key];
    if (typeof b === "boolean") out[key] = b;
  }
  for (const key of STRING_KEYS) {
    const s = text(src[key], 64);
    if (s !== undefined) out[key] = s;
  }
  const summary = text(src.summary, META_SUMMARY_MAX);
  if (summary !== undefined) out.summary = summary;
  const description = text(src.description, META_DESCRIPTION_MAX);
  if (description !== undefined) out.description = description;
  const authors = textList(src.authors, META_AUTHORS_MAX, 80);
  if (authors !== undefined) out.authors = authors;
  const categories = textList(src.categories, META_CATEGORIES_MAX, 40);
  if (categories !== undefined) out.categories = categories;
  return Object.keys(out).length === 0 ? undefined : out;
}

/** 写侧:快照行 meta(create 与 update 共用同一份) */
export function snapshotMeta(
  url: string,
  sourceId: number,
  extra?: LeaderboardItemMeta,
): Record<string, unknown> {
  const clean = normalizeExtra(extra);
  return clean === undefined ? { url, sourceId } : { url, sourceId, ...clean };
}

export interface SnapshotMeta {
  url: string;
  extra: LeaderboardItemMeta;
}

/** 读侧:任意历史/异常 meta → { url, extra },永不抛错 */
export function readSnapshotMeta(raw: unknown): SnapshotMeta {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { url: "", extra: {} };
  }
  const obj = raw as Record<string, unknown>;
  return {
    url: typeof obj.url === "string" ? obj.url : "",
    extra: normalizeExtra(obj) ?? {},
  };
}
