/**
 * 登录/注册回跳参数(2026-10-09 验收反馈:付费文/登录可见文,登录或注册后
 * 应回到原文章而非首页):next 仅接受站内根相对路径(拒 //、/\、外链,防
 * open redirect)。另以 sessionStorage 便签跨「注册→离站点邮件验证链接→
 * 回来登录」一跳——邮件链接是预生成的,回跳目标带不上,落登录页时从便签
 * 兜底恢复,登录成功即消费。
 */
export const POST_LOGIN_NEXT_KEY = "auth:post-login-next";

/** open redirect 防线:非站内根相对路径一律回首页(登录/注册页共用) */
export function normalizeNextPath(next?: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/";
}

/** 站内跳转链构造:无有效 next 返回原路径,否则带 ?next=(编码) */
export function withNext(path: string, next?: string | null): string {
  return normalizeNextPath(next) === "/" ? path : `${path}?next=${encodeURIComponent(next ?? "")}`;
}

/** 记录回跳意图(仅站内路径;SSR/隐私模式静默降级为纯 query 链路) */
export function savePostLoginNext(next: string): void {
  if (typeof window === "undefined" || normalizeNextPath(next) === "/") return;
  try {
    window.sessionStorage.setItem(POST_LOGIN_NEXT_KEY, next);
  } catch {
    // 存不进就算了:回跳退化为纯 query 链路
  }
}

/** 读取回跳意图:未存或非站内路径返回 null */
export function readPostLoginNext(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(POST_LOGIN_NEXT_KEY);
    return v && normalizeNextPath(v) !== "/" ? v : null;
  } catch {
    return null;
  }
}

/** 消费回跳意图(登录成功整跳前调用) */
export function clearPostLoginNext(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(POST_LOGIN_NEXT_KEY);
  } catch {
    // 同上,忽略
  }
}
