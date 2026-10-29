/**
 * admin 守卫(arch/05-services §3.2):middleware 只做预检,防伪在这里。
 * 页面用 requireAdminPage()(非 admin → redirect 登录页),
 * 端点用 requireAdminRequest()(返回 null,由 Handler 自定 401)。
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_LOGIN_PATH, ADMIN_ROLE } from "./constants";
import { readFullSessionUser, type FullClaims } from "./issuer";

export { ADMIN_LOGIN_PATH };

/** admin 页面守卫:完整校验 + role 判定,不过则跳登录页(带 next 回跳) */
export async function requireAdminPage(): Promise<FullClaims> {
  const store = await cookies();
  const claims = await readFullSessionUser(store.toString());
  if (!claims || claims.role !== ADMIN_ROLE) {
    redirect(`${ADMIN_LOGIN_PATH}?next=/admin`);
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
