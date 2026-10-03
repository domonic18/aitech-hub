/**
 * admin 列表页公共工具(纯函数,无 React;review P4 收敛):posts/users/media
 * 三页原先各持逐字副本。约定:分段走 ?status=、页码走 ?page=(>1 才携带)、
 * 搜索走 ?q=;media 页的 kind/ref 组合参数各页自持。
 */

/** 页码解析:非法回落 1 */
export function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** 分段解析:不在白名单回落默认(各页传入自己的分段常量) */
export function parseListSegment<T extends string>(
  segments: readonly T[],
  raw: string | undefined,
  fallback: T,
): T {
  return (segments as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
}

/** 页码窗口(当前页居中,首尾恒在;null = 省略号) */
export function pageWindow(cur: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, cur - 1, cur, cur + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

/** status/page/q 形态的列表链接(posts/users 通用) */
export function adminListHref(
  base: string,
  params: { status?: string; page?: number; q?: string },
): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  if (params.page !== undefined && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
