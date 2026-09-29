/** 展示层纯函数:列表摘要/正文的派生文案,不回写库(03 文档 §3) */

/** HTML 转纯文本(卡片摘要用,非安全清洗——安全清洗唯一实现是 clean-html.ts) */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXCERPT_MAX = 160;

/** 列表/卡片摘要:excerpt → seoDescription → 正文纯文本截断 */
export function excerptOf(post: {
  excerpt: string | null;
  seoDescription?: string | null;
  contentHtml?: string | null;
  contentMd?: string | null;
}): string {
  const direct = (post.excerpt ?? post.seoDescription ?? "").trim();
  if (direct) return direct.slice(0, EXCERPT_MAX);
  const fromHtml = post.contentHtml ? plainText(post.contentHtml) : "";
  const fromMd = post.contentMd ?? "";
  return (fromHtml || fromMd).slice(0, EXCERPT_MAX);
}
