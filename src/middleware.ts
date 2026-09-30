/**
 * middleware(arch/05-services §3.2/§6,两职合一):
 * 1) /admin 预检:Cookie 存在性 + exp 本地解读(decodeJwt 不验签、不查 Redis、不依赖
 *    AUTH_SECRET)——防伪不靠 middleware,完整校验在 guard.ts;
 * 2) request id:全路由生成并回写 X-Request-Id(响应头),排障对账用。
 */
import { decodeJwt } from "jose";
import { NextResponse, type NextRequest } from "next/server";

// middleware 不 import src/lib(避免把 env 依赖带进边缘环境);常量以 session.ts 为真相源
const ACCESS_COOKIE_NAME = "ah_at";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};

export function middleware(req: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();

  if (req.nextUrl.pathname.startsWith("/admin") && req.nextUrl.pathname !== "/admin/login") {
    let alive = false;
    const token = req.cookies.get(ACCESS_COOKIE_NAME)?.value;
    if (token) {
      try {
        alive = (decodeJwt(token).exp ?? 0) * 1000 > Date.now();
      } catch {
        alive = false; // 非法/过期 → 预检不过,完整校验也不该放行
      }
    }
    if (!alive) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      url.searchParams.set("next", req.nextUrl.pathname);
      const redirectRes = NextResponse.redirect(url);
      redirectRes.headers.set("X-Request-Id", requestId);
      return redirectRes;
    }
  }

  const res = NextResponse.next();
  res.headers.set("X-Request-Id", requestId);
  return res;
}
