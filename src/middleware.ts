/**
 * middleware(arch/05-services §3.2/§6,三职合一):
 * 1) /admin 预检:Cookie 存在性 + exp 本地解读(decodeJwt 不验签、不查 Redis、不依赖
 *    AUTH_SECRET)——防伪不靠 middleware,完整校验在 guard.ts;
 * 2) request id:全路由生成并回写 X-Request-Id(响应头),排障对账用;
 * 3) 爬虫抓取入账(2026-10-07 方案B):已命名爬虫(bots.ts 名单)抓 HTML 页面时,
 *    waitUntil 内部端点异步记 PV——爬虫不发 beacon,这是唯一逐请求捕获点;
 *    失败静默(统计尽力而为,不影响主链路)。
 */
import { decodeJwt } from "jose";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { ACCESS_COOKIE_NAME, ADMIN_LOGIN_PATH, ADMIN_PATH_PREFIX } from "@/lib/auth/constants";
import { classifyBotUa } from "@/lib/stats/bots";

// 仅引用零依赖常量模块(auth/constants.ts 不 import env/jose,边缘环境安全);
// 预检只做 Cookie 存在性 + exp 本地解读,防伪在 guard.ts;
// stats/bots.ts 同为零依赖纯函数(勿引 classify.ts,node:crypto 进不了边缘)

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};

/** 非页面路径:API/订阅源/站点地图/带扩展名的静态资源,均不入爬虫统计 */
const BOT_PATH_SKIP_RE = /^\/api\/|^\/feed(\/|$)|^\/sitemap|^\/robots\.txt$|\/[^/]*\.[a-z0-9]+$/i;

export async function middleware(req: NextRequest, event: NextFetchEvent): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // trailingSlash:true 下实际请求带尾斜杠(/admin/login/),豁免必须按去尾斜杠口径,
  // 否则登录页自身进保护分支 → 重定向环(e2e 用例 6 发现的 M4 回归)
  const pathname = req.nextUrl.pathname;
  const bare = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  if (bare.startsWith(ADMIN_PATH_PREFIX) && bare !== ADMIN_LOGIN_PATH) {
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
      url.pathname = ADMIN_LOGIN_PATH;
      url.search = "";
      url.searchParams.set("next", bare);
      const redirectRes = NextResponse.redirect(url);
      redirectRes.headers.set("X-Request-Id", requestId);
      return redirectRes;
    }
  }

  // 爬虫抓取入账:仅 GET 页面请求;UA 分类在边缘侧零依赖完成,入账走内部端点
  // (middleware 运行时无 redis/pg)。origin 显式带上——内部端点的同源校验
  // 以请求 host 比对,两侧同源于 target URL,任何代理拓扑下自洽。
  const ua = req.headers.get("user-agent");
  if (req.method === "GET" && ua && !BOT_PATH_SKIP_RE.test(bare)) {
    const bot = classifyBotUa(ua);
    if (bot) {
      const target = new URL("/api/stats/bot", req.url);
      event.waitUntil(
        fetch(target, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-original-ua": ua.slice(0, 512),
            origin: target.origin,
          },
          body: "{}",
        }).catch(() => undefined), // 统计尽力而为:端点抖动不影响页面响应
      );
    }
  }

  const res = NextResponse.next();
  res.headers.set("X-Request-Id", requestId);
  return res;
}
