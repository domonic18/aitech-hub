/**
 * 小红书体改写(M49 批X2):文章 markdown → 笔记草稿(标题/正文/话题标签)。
 * 契约解析失败走 chatJsonTask 内建重试;终稿仍有硬闸截断(物料必须直接可用,
 * 不回吐超限稿让用户手删)。平台口径:标题 ≤20 字、正文 ≤1000 字、话题 3-6 个。
 */
import { chatJsonTask, type ParsedTask } from "../ai/chat-json-task";
import type { ResolvedAiModel } from "../ai/resolver";

export const XHS_TITLE_MAX = 20;
export const XHS_CONTENT_MAX = 1000;
export const XHS_TAGS_MAX = 6;

export interface XhsDraft {
  title: string;
  content: string;
  tags: string[];
}

/** 契约解析(失败回错误串,chatJsonTask 据此重试):字数/数量超限即打回 */
export function parseXhsDraft(raw: string): ParsedTask<XhsDraft> {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, error: "输出不是 JSON" };
  }
  const o = v as { title?: unknown; content?: unknown; tags?: unknown };
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const content = typeof o.content === "string" ? o.content.trim() : "";
  const tags = Array.isArray(o.tags)
    ? o.tags.filter((t): t is string => typeof t === "string")
    : [];
  if (title === "" || [...title].length > XHS_TITLE_MAX) {
    return { ok: false, error: `标题需 1-${XHS_TITLE_MAX} 字(当前 ${[...title].length})` };
  }
  if (content.length < 100 || content.length > XHS_CONTENT_MAX) {
    return { ok: false, error: `正文需 100-${XHS_CONTENT_MAX} 字(当前 ${content.length})` };
  }
  const cleanTags = tags
    .map((t) => t.trim().replace(/^#/, ""))
    .filter((t) => t !== "")
    .slice(0, XHS_TAGS_MAX);
  if (cleanTags.length < 3) {
    return { ok: false, error: "话题标签需至少 3 个" };
  }
  return { ok: true, data: { title, content, tags: cleanTags } };
}

const SYSTEM = [
  "你是小红书资深内容编辑,把技术文章改写成小红书笔记。",
  `输出 JSON:{"title":"标题","content":"正文","tags":["话题",...]}`,
  `硬规则:标题 ≤${XHS_TITLE_MAX} 字(可含 1 个 emoji,不堆砌);正文 ${XHS_CONTENT_MAX} 字以内、`,
  "口语化短段落、适度 emoji、结尾一句互动引导;tags 3-6 个主题词(不带 # 号)。",
  "禁止外链、禁止出现「公众号/博客/网站」等导流词;技术干货保留具体数字与结论。",
].join("");

export async function rewriteForXhs(
  model: ResolvedAiModel,
  postTitle: string,
  contentMd: string,
): Promise<XhsDraft> {
  const draft = await chatJsonTask<XhsDraft>(
    model,
    parseXhsDraft,
    SYSTEM,
    `文章标题:${postTitle}\n\n正文(markdown):\n${contentMd.slice(0, 12000)}`,
    "xhs_rewrite",
    { maxTokens: 3000 },
  );
  // 终稿硬闸:契约已限,此处截断兜底(物料直接可用,不回吐超限稿)
  return {
    title: [...draft.title].slice(0, XHS_TITLE_MAX).join(""),
    content: [...draft.content].slice(0, XHS_CONTENT_MAX).join(""),
    tags: draft.tags.slice(0, XHS_TAGS_MAX),
  };
}
