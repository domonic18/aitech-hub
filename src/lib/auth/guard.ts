/**
 * admin 守卫(arch/05-services §3.2):middleware 只做预检,防伪在这里。
 * 页面用 requireAdminPage()(非 admin → redirect 登录页),
 * 端点用 requireAdminRequest()(返回 null,由 Handler 自定 401)。
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readFullSessionUser, type FullClaims } from "./issuer";

export const ADMIN_LOGIN_PATH = "/admin/login";

/** admin 页面守卫:完整校验 + role 判定,不过则跳登录页(带 next 回跳) */
export async function requireAdminPage(): Promise<FullClaims> {
  const store = await cookies();
  const claims = await readFullSessionUser(store.toString());
  if (!claims || claims.role !== "admin") {
    redirect(`${ADMIN_LOGIN_PATH}?next=/admin`);
  }
  return claims;
}

/** admin 端点守卫:完整校验 + role 判定,不过返回 null */
export async function requireAdminRequest(
  req: Pick<Request, "headers">,
): Promise<FullClaims | null> {
  const claims = await readFullSessionUser(req.headers.get("cookie"));
  if (!claims || claims.role !== "admin") return null;
  return claims;
}
