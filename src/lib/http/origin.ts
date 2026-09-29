/**
 * mutation 类 Route Handler 的 Origin/Host 校验(04 文档 §4):
 * Route Handlers 没有 Server Actions 的内建 CSRF 防护,这一步补位。
 * 纯函数,便于单测。
 */

function normalizeHost(host: string | null): string | null {
  if (!host) return null;
  // x-forwarded-host 可能带端口或逗号链,取第一跳并去空白
  return host.split(",")[0]?.trim().toLowerCase() ?? null;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** 请求是否同源:Origin(优先)或 Referer 的 host 与请求 host 一致 */
export function isSameOrigin(
  req: Pick<Request, "headers">,
  forwardedHost?: string | null,
): boolean {
  const host = normalizeHost(
    forwardedHost ?? req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
  );
  if (!host) return false;
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) return false;
  return originOf(origin) === host;
}
