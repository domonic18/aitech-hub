/**
 * 榜单展示格式化(M63,纯函数无 React):紧凑计数、价格、作者串。
 * 全部对 null/NaN 兜底回空串,由调用侧决定是否渲染(缺字段整项省略)。
 */

/** 12.3k / 1.2M / 982 */
export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "";
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))}k`;
  return String(Math.round(n));
}

/** 输出价:$0.6 / $15 / $120(USD / 1M tokens) */
export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "免费";
  const text = n >= 1 ? String(Number(n.toFixed(2))) : String(Number(n.toFixed(3)));
  return `$${text}`;
}

/** 作者串:前 limit 人 + 「等 N 人」 */
export function formatAuthors(authors: string[] | undefined, limit = 3): string {
  if (authors === undefined || authors.length === 0) return "";
  const head = authors.slice(0, limit).join("、");
  return authors.length > limit ? `${head} 等 ${authors.length} 人` : head;
}

/** 分数(指数/热度):整数原样,小数留两位 */
export function formatScore(n: number | null, unit: string | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return unit === null ? text : `${text} ${unit}`;
}
