/**
 * L0 直答判定与话术拼装(M66,plan §3.1):纯函数,零 IO——把「这句话属于
 * 哪一档」从服务编排里剥出来,便于单测锁死触发词与优先级。
 *
 * 优先级(先命中先生效):帮助 → 继续 → 转人工 → 绑定码 → 关键词 → L1 检索。
 * 「继续」必须排在关键词之前:后台若误配关键词「继续」也不该劫持回捞语义。
 */
import { postPath } from "@/lib/content/post-path";
import { env } from "@/lib/env";

import {
  WECHAT_MP_BIND_CODE_ALPHABET,
  WECHAT_MP_BIND_CODE_LENGTH,
  WECHAT_MP_CONTINUE_WORDS,
  WECHAT_MP_HELP_WORDS,
  WECHAT_MP_MAX_QUERY_CHARS,
} from "./constants";

/** 入站文本归一(全半角空白剥离;公众号用户常带尾随空格) */
export function normalizeInput(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** 「继续」/帮助等短指令:大小写不敏感的全等匹配 */
function equalsAny(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((w) => w.toLowerCase() === lower);
}

export function isContinueWord(text: string): boolean {
  return equalsAny(normalizeInput(text), WECHAT_MP_CONTINUE_WORDS);
}

export function isHelpWord(text: string): boolean {
  return equalsAny(normalizeInput(text), WECHAT_MP_HELP_WORDS);
}

/** 转人工:包含即触发(「我要转人工」也应识别) */
export function isHandoffPhrase(text: string, keywords: readonly string[]): boolean {
  const t = normalizeInput(text).toLowerCase();
  return keywords.some((k) => k.trim() !== "" && t.includes(k.trim().toLowerCase()));
}

/** 一次性绑定码:长度与字符集双门(不查 Redis,纯形态判定) */
export function looksLikeBindCode(text: string): boolean {
  const t = normalizeInput(text).toUpperCase();
  if (t.length !== WECHAT_MP_BIND_CODE_LENGTH) return false;
  return [...t].every((ch) => WECHAT_MP_BIND_CODE_ALPHABET.includes(ch));
}

export function isTooLongQuery(text: string): boolean {
  return text.length > WECHAT_MP_MAX_QUERY_CHARS;
}

export interface KeywordLike {
  keyword: string;
}

/**
 * 关键词直连判定:包含匹配(「MedTrinity是什么」也命中「MedTrinity」),
 * 大小写不敏感;多词命中取最长者(长词更具体)。空词/空表 → null。
 */
export function matchKeyword<T extends KeywordLike>(
  text: string,
  keywords: readonly T[],
): T | null {
  const t = normalizeInput(text).toLowerCase();
  if (t === "") return null;
  let best: T | null = null;
  for (const kw of keywords) {
    const k = kw.keyword.trim().toLowerCase();
    if (k === "" || !t.includes(k)) continue;
    if (!best || k.length > best.keyword.trim().length) best = kw;
  }
  return best;
}

export function absoluteSiteUrl(path: string): string {
  return /^https?:\/\//i.test(path) ? path : new URL(path, env.NEXT_PUBLIC_SITE_URL).toString();
}

/**
 * 关键词直答文本(承接旧服务 MedTrinity 这类主路径):
 * 有挂载文章 → 「标题 + 摘要 + 完整链接」;无文章 → 后台话术或默认提示。
 * 订阅号里 URL 不可点,故链接单独成行便于长按复制。
 */
export function buildKeywordReply(params: {
  keyword: string;
  post?: {
    id: bigint | number | string;
    /** 存量文章 slug 可能为空,postPath 会把空段归一掉 */
    slug: string | null;
    title: string;
    excerpt: string | null;
  } | null;
  replyText: string | null;
  fallbackText: string;
}): string {
  const { post } = params;
  if (post) {
    const url = absoluteSiteUrl(postPath(BigInt(post.id), post.slug));
    const excerpt = (post.excerpt ?? "").trim().slice(0, 120);
    return [`《${post.title}》`, excerpt, url].filter((l) => l !== "").join("\n");
  }
  const custom = (params.replyText ?? "").trim();
  return custom !== "" ? custom : params.fallbackText;
}
