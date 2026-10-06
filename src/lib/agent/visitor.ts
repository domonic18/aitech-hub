/**
 * 匿名访客身份(K2.5):cookie `ah_av`(uuid,365d,httpOnly)——Drawer 会话
 * 的归属锚。三期登录上线后可做账号归并,一期不与 admin 会话发生关系。
 * 属性口径同 auth/issuer(sameSite lax;secure 按 SITE_URL 协议)。
 */
import { type NextRequest, type NextResponse } from "next/server";

import { env } from "../env";

export const VISITOR_COOKIE_NAME = "ah_av";
export const VISITOR_COOKIE_MAX_AGE = 365 * 24 * 3600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 读访客 id(缺/非法 → null;调用方首次下发) */
export function readVisitorId(req: Pick<NextRequest, "cookies">): string | null {
  const v = req.cookies.get(VISITOR_COOKIE_NAME)?.value ?? "";
  return UUID_RE.test(v) ? v : null;
}

/** 新访客 id(校验格式的 uuid,归一为小写) */
export function newVisitorId(): string {
  return crypto.randomUUID();
}

/** 响应挂访客 cookie(每次首次交互补发;已带合法 cookie 的请求不重发) */
export function attachVisitorCookie(res: NextResponse, visitorId: string): NextResponse {
  res.cookies.set(VISITOR_COOKIE_NAME, visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NEXT_PUBLIC_SITE_URL.startsWith("https"),
    maxAge: VISITOR_COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}

/** 路由入口统一取访客:已有则复用,无则新造(调用方负责把 id 挂到响应) */
export function resolveVisitorId(req: NextRequest): { id: string; fresh: boolean } {
  const existing = readVisitorId(req);
  if (existing) return { id: existing, fresh: false };
  return { id: newVisitorId(), fresh: true };
}
