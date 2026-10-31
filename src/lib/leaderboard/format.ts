/**
 * 榜单展示格式化(M63,纯函数无 React):紧凑计数、价格、分数。
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

/** 人民币输出价(按汇率折算,仅展示):¥36 / ¥0.67;整数价不留尾零 */
export function formatCnyPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "免费";
  const text = n >= 1 ? String(Number(n.toFixed(1))) : String(Number(n.toFixed(2)));
  return `¥${text}`;
}

/** 来源域名(署名 chip 展示):https://www.huggingface.co/models?sort=trending → huggingface.co */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 分数(指数/热度):整数原样,小数留两位 */
export function formatScore(n: number | null, unit: string | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return unit === null ? text : `${text} ${unit}`;
}
