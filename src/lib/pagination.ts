/**
 * 列表分页页码解析(唯一出口)。2026-11-01 收口:此前站内三处 `/page/[page]`
 * 各持逐字副本、两处后台 API 再各持一份,语义两分。两种语义都必须保留:
 *  - parsePage:非法/越界回落 1 —— API 与管理页列表用,客户端传坏参数不该 404。
 *  - parsePageFromSecond:>= 2 才合法,否则 null —— 站内 `/page/[page]` 路由用;
 *    第 1 页由上一级路由承载,非法段必须 404,不能静默落到第 1 页造出重复 URL。
 */

/** 页码解析:非法回落 1 */
export function parsePage(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** 分页路由页码:仅 >= 2 合法,其余返回 null(调用方 notFound) */
export function parsePageFromSecond(raw: string | null | undefined): number | null {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(n) && n >= 2 ? n : null;
}
