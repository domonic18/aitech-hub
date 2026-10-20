/**
 * card-renderer HTTP 客户端(M31 批B;COS 引图补丁改内联口径):消毒后 HTML →
 * 服务渲染 → PNG 字节。站内引图不再改写 file:// 直读本地卷(COS 主存后卷缺新图,
 * sidecar 静默占位即旧缺陷)——POST 前经 media-inline 读存储层转 data URI 内联,
 * 渲染服务收自包含 HTML,零密钥零外网边界不变。失败映射人话短句(429 忙/413
 * 超高/504 超时/不可达),供 agent 直接转述。
 */
import { env } from "../env";

import { inlineSiteMediaRefs } from "./media-inline";

export type RenderedCard = { png: Uint8Array; width: number; height: number };

function humanizeStatus(status: number, serverError: string): string {
  if (status === 429) return "渲染服务忙(并发已满),请稍后重试";
  if (status === 413) {
    return serverError || "卡片高度超限,请先把 maxHeight 调到 6000~8000 再试,仍超则拆成多张卡";
  }
  if (status === 504) return "渲染超时,请精简卡片内容后重试";
  return serverError || `渲染服务返回 ${status}`;
}

export async function renderCardPng(
  html: string,
  opts: { width?: number; scale?: number; maxHeight?: number } = {},
): Promise<RenderedCard> {
  const inlined = await inlineSiteMediaRefs(html);
  let res: Response;
  try {
    res = await fetch(`${env.CARD_RENDERER_URL}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        html: inlined,
        width: opts.width ?? 900,
        scale: opts.scale ?? 2,
        // 条件展开:不传时服务端按默认 4000,既有精确 body 断言不受影响
        ...(opts.maxHeight !== undefined ? { maxHeight: opts.maxHeight } : {}),
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
