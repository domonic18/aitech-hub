/**
 * 外链图片抓取(M17 批③ 自 worker/media.ts 提为共享):公众号同步转存外链正文图
 * 与一键发文 media.transfer 共用同款口径——content-type 白名单 + 大小上限 + 超时。
 * SSRF 边界(评审 S1):URL 仅来自 admin 后台或站内已存正文(会话守卫写入),
 * 风险有界;开放多管理员/三方导入前需先解析 DNS 并拒绝私网段(二期硬化项)。
 */
import { MEDIA_LIMITS } from "./media-schema";

export async function fetchExternalImage(url: string): Promise<{ data: Uint8Array; mime: string }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(MEDIA_LIMITS.fetchTimeoutMs),
    headers: { "user-agent": "aitech-hub-media-transfer/1.0" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MEDIA_LIMITS.maxFetchBytes) throw new Error("超过大小上限");
  return { data: buf, mime: mime || "application/octet-stream" };
}
