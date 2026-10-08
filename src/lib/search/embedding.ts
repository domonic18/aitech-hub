/**
 * 混合检索 embedding 共享层(M20 批②,arch/04 §3.2):维度常量、pgvector 文本
 * 序列化、三域内容 → embedding 文本构造(纯函数,单测锚点)。
 * 文本取向:标题/摘要权重最高靠前置;正文轻清洗(markdown 剥标记留文字),
 * 尾部截断——embedding-3 输入上限 8k token,4k 字符(中文≈4k token)留足余量。
 */

export const EMBEDDING_DIMS = 1024; // embedding-3 支持档 256/512/1024/2048 取衡

export const EMBED_ENTITY_POST = "post";
export const EMBED_ENTITY_TELEGRAM = "telegram";
export const EMBED_ENTITY_REPO = "repo";
export const EMBED_ENTITY_TYPES = [
  EMBED_ENTITY_POST,
  EMBED_ENTITY_TELEGRAM,
  EMBED_ENTITY_REPO,
] as const;
export type EmbedEntityType = (typeof EMBED_ENTITY_TYPES)[number];

/** 正文/README 参与 embedding 的最大字符数(整体上限见 EMBED_TEXT_MAX) */
const EMBED_BODY_MAX = 3500;
/** 单条 embedding 文本总上限 */
export const EMBED_TEXT_MAX = 4000;

/** number[] → pgvector 文本字面量('[a,b,…]')(raw SQL 参数化前的唯一出口) */
export function serializeVector(v: number[]): string {
  if (v.length !== EMBEDDING_DIMS) {
    throw new Error(`向量维度不符(期望 ${EMBEDDING_DIMS},实际 ${v.length})`);
  }
  return `[${v.join(",")}]`;
}

/** markdown → 纯文本:图片剥离、链接留文字、代码留内容去标记、装饰符折叠 */
export function stripMarkdownForEmbed(md: string): string {
  return md
    .replace(/```[a-zA-Z0-9_-]*\n?/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[#>*_~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 拼接 + 截断(空段剔除;总长超限尾部丢字,不抛错——embedding 文本允许不完整) */
function joinCapped(parts: string[]): string {
  const joined = parts
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .join("\n");
  return joined.slice(0, EMBED_TEXT_MAX);
}

export interface PostEmbedSource {
  title: string;
  excerpt: string | null;
  contentMd: string | null;
}

export interface TelegramEmbedSource {
  title: string | null;
  summary: string;
  aiSummary: string | null;
  aiTopic: string | null;
}

export interface RepoEmbedSource {
  fullName: string;
  description: string | null;
  readmeMd: string | null;
}

export function buildPostEmbedText(s: PostEmbedSource): string {
  return joinCapped([
    s.title,
    s.excerpt ?? "",
    stripMarkdownForEmbed(s.contentMd ?? "").slice(0, EMBED_BODY_MAX),
  ]);
}

export function buildTelegramEmbedText(s: TelegramEmbedSource): string {
  return joinCapped([s.title ?? "", s.aiTopic ?? "", s.aiSummary ?? "", s.summary]);
}

export function buildRepoEmbedText(s: RepoEmbedSource): string {
  return joinCapped([
    s.fullName,
    s.description ?? "",
    stripMarkdownForEmbed(s.readmeMd ?? "").slice(0, EMBED_BODY_MAX),
  ]);
}
