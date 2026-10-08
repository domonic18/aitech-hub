/**
 * 命中关键词高亮切分(K1):text 按词项切段,组件侧 map 渲染 <mark>,
 * 禁 dangerouslySetInnerHTML(防注入红线)。纯函数,单测钉死。
 */

export type MarkSegment = string | { mark: string };

/**
 * 按词项切段:大小写不敏感 indexOf 扫描;词项按长度降序(长词优先,防短词
 * 嵌进长词命中区间);已占用的区间被后续词项跳过(不重叠)。无命中/空词项
 * → [text](原文单段);空文本 → []。
 */
export function highlightSegments(text: string, terms: string[]): MarkSegment[] {
  if (text === "") return [];
  const sorted = [...new Set(terms.filter((t) => t.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  if (sorted.length === 0) return [text];

  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const term of sorted) {
    const t = term.toLowerCase();
    for (let from = 0; ; from += t.length) {
      const idx = lower.indexOf(t, from);
      if (idx === -1) break;
      const end = idx + t.length;
      if (!ranges.some(([s, e]) => idx < e && end > s)) ranges.push([idx, end]);
    }
  }
  if (ranges.length === 0) return [text];

  ranges.sort((a, b) => a[0] - b[0]);
  const out: MarkSegment[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) out.push(text.slice(pos, s));
    out.push({ mark: text.slice(s, e) });
    pos = e;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}
