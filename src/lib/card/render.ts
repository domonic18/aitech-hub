/**
 * card-renderer HTTP 客户端(M31 批B):消毒后 HTML → 服务渲染 → PNG 字节。
 * 站内引图改写:/wp-content/uploads/* 是 URL 约定,chromium 直读须 file:// 绝对
 * 路径——这里按 CARD_RENDERER_MEDIA_ROOT(须与服务的 MEDIA_ROOT、compose 挂载
 * 三处一致)改写 src 与 css url(),服务侧 MEDIA_ROOT 包含校验为最终防线。
 * 失败映射人话短句(429 忙/413 超高/504 超时/不可达),供 agent 直接转述。
 */
import { env } from "../env";

const MEDIA_PREFIX = "/wp-content/uploads/";

/** src="/wp-content/uploads/x" 与 css url(/wp-content/uploads/x) → file:// 绝对路径。
 *  路径约定同 storage.ts:URL 前缀剥掉,余下 YYYY/MM/f 直接拼 MEDIA_ROOT(非拼接前缀)。 */
export function rewriteLocalMediaRefs(html: string, mediaRoot: string): string {
  const root = mediaRoot.replace(/\/+$/, "");
  const re = new RegExp(`(src\\s*=\\s*["']|url\\(\\s*["']?)${MEDIA_PREFIX}`, "g");
  return html.replace(re, (_m, lead: string) => `${lead}file://${root}/`);
}

export type RenderedCard = { png: Uint8Array; width: number; height: number };

function humanizeStatus(status: number, serverError: string): string {
  if (status === 429) return "渲染服务忙(并发已满),请稍后重试";
  if (status === 413) return serverError || "卡片高度超限,请拆成多张卡";
  if (status === 504) return "渲染超时,请精简卡片内容后重试";
  return serverError || `渲染服务返回 ${status}`;
}

export async function renderCardPng(
  html: string,
  opts: { width?: number; scale?: number } = {},
): Promise<RenderedCard> {
  let res: Response;
  try {
    res = await fetch(`${env.CARD_RENDERER_URL}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        html: rewriteLocalMediaRefs(html, env.CARD_RENDERER_MEDIA_ROOT),
        width: opts.width ?? 900,
        scale: opts.scale ?? 2,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("卡片渲染服务不可达(检查 card-renderer 服务与 CARD_RENDERER_URL)");
  }
  if (!res.ok) {
    let serverError = "";
    try {
      serverError = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* 非 JSON 错误体,保底空串 */
    }
    throw new Error(humanizeStatus(res.status, serverError));
  }
  const width = Number(res.headers.get("x-card-width"));
  const height = Number(res.headers.get("x-card-height"));
  return {
    png: new Uint8Array(await res.arrayBuffer()),
    width: Number.isFinite(width) && width > 0 ? width : 0,
    height: Number.isFinite(height) && height > 0 ? height : 0,
  };
}
