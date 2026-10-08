/**
 * 付费文章预览截断(M21 批③,提案 §5.4):ISR 缓存页对所有人(含爬虫)
 * 下发同一份服务端截断摘要,全文永不进 RSC payload(防绕过也防 cloaking)。
 * 纯 markdown 源截断:上限内最后空白处断句;代码围栏未闭合则补闭合,
 * 防预览区把后文当代码块渲染泄漏。
 */
export const PREVIEW_CHAR_LIMIT = 800;

export function previewMarkdown(md: string, limit: number = PREVIEW_CHAR_LIMIT): string {
  if (md.length <= limit) return md;
  const cut = md.slice(0, limit);
  // 断在最后一个空白处(负向前瞻 = 后面再无空白),避免截断中文词/链接语法中段
  const lastSpace = cut.search(/\s(?![\s\S]*\s)/);
  const head = lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut;
  // 围栏闭合:奇数个 ``` 视为未闭合代码块,补齐围栏
  const fences = (head.match(/^```/gm) ?? []).length;
  return fences % 2 === 1 ? `${head}\n\`\`\`` : head;
}
