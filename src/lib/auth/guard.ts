/**
 * admin 守卫(arch/05-services §3.2):middleware 只做预检,防伪在这里。
 * 页面用 requireAdminPage()(非 admin → redirect 登录页),
 * 端点用 requireAdminRequest()(返回 null,由 Handler 自定 401)。
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_LOGIN_PATH, ADMIN_ROLE } from "./constants";
import { readFullSessionUser, type FullClaims } from "./issuer";

export { ADMIN_LOGIN_PATH };

/** 深链回跳(P2-23):middleware 为每请求注入 x-pathname(见 middleware.ts 职责④),
 *  据此回跳原页而非固定 /admin;取不到/形不合法(直连静态资源等理论外路径)
 *  退回 /admin。仅收本域路径,防伪造头开外域——登录提交侧 LoginForm 对 next
 *  还有同一规则的第二道校验。 */
async function currentAdminPath(): Promise<string> {
  const raw = (await headers()).get("x-pathname") ?? "";
  return raw.startsWith("/admin") && !raw.startsWith("//") ? raw : "/admin";
}

/** admin 页面守卫:完整校验 + role 判定,不过则跳登录页(带 next 深链回跳;
 *  server component 拿不到自身路径,依赖 middleware 注入的 x-pathname) */
export async function requireAdminPage(): Promise<FullClaims> {
  const store = await cookies();
  const claims = await readFullSessionUser(store.toString());
  if (!claims || claims.role !== ADMIN_ROLE) {
    redirect(`${ADMIN_LOGIN_PATH}?next=${await currentAdminPath()}`);
  }
  return claims;
}

/** admin 端点守卫:完整校验 + role 判定,不过返回 null。
 * M56 review P1-2:与 requireSessionActor 语义对齐——Authorization 头在场
 * 一律拒绝(PAT 不得搭会话 cookie 调会话专用端点),消除两套守卫灰面。 */
export async function requireAdminRequest(
  req: Pick<Request, "headers">,
): Promise<FullClaims | null> {
  if (req.headers.get("authorization") !== null) return null;
  const claims = await readFullSessionUser(req.headers.get("cookie"));
  if (!claims || claims.role !== ADMIN_ROLE) return null;
  return claims;
}

// ---- 用户中心守卫(M65 安全收口)----
// 旧实现走 session.ts#verifyAccessToken(只验签),吊销后的会话仍可用到 token
// 自然过期(最长 7 天)。账号中心读写一律改走完整校验:JWT 验签 + Redis
// jti 登记双查(issuer.ts),吊销即时生效。

/** 用户中心页面守卫:未登录 / 已吊销 → 308 去登录页并带 next 回跳 */
export async function requireAccountPage(nextPath: string): Promise<FullClaims> {
  const store = await cookies();
  const claims = await readFullSessionUser(store.toString());
  if (!claims) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return claims;
}

/** 用户中心端点守卫:完整校验;Authorization 头在场一律拒绝(PAT 无会话语义) */
export async function requireAccountRequest(
  req: Pick<Request, "headers">,
): Promise<FullClaims | null> {
  if (req.headers.get("authorization") !== null) return null;
  return readFullSessionUser(req.headers.get("cookie"));
}
