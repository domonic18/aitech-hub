/**
 * card-renderer /snapshot 调用器(M56 批A):URL → 渲染后 HTML。SPA 套餐页
 * (价格在前端 bundle,无接口可摸)的取数通道;白名单钉在渲染端
 * (RENDER_ALLOWED_HOSTS),调用侧只传注册表内的官方页 URL。
 * CARD_RENDERER_URL 未配置/不可达 = 源失败上抛(连败告警可见,不静默)。
 */
// 内网 HTTP 调用上限:须覆盖渲染侧整页预算(load+滚动+点击+settle,页面超时
// 上限 45s——首拍 10s 实测不够 Kimi 重 SPA,验收期 2026-10-29 放宽对齐)
const RENDER_TIMEOUT_MS = 50_000;

export interface SnapshotResult {
  html: string;
  finalUrl: string;
}

export async function snapshotHtml(url: string, clickText?: string): Promise<SnapshotResult> {
  const base = process.env.CARD_RENDERER_URL;
  if (!base) throw new Error("CARD_RENDERER_URL 未配置,rendered 型渠道不可用");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, ...(clickText === undefined ? {} : { clickText }) }),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as {
      html?: string;
      finalUrl?: string;
      error?: string;
    } | null;
    if (!res.ok || body === null || typeof body.html !== "string") {
      throw new Error(`snapshot http ${res.status}: ${body?.error ?? "响应不可解析"}`);
    }
    return { html: body.html, finalUrl: body.finalUrl ?? url };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`snapshot 调用超时(${RENDER_TIMEOUT_MS}ms)`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
