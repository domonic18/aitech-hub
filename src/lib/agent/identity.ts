/**
 * Agent 身份分流(K2.6):一期「登录账号」= admin(手机号+密码,ah_at JWT),
 * 其余一律游客(ah_av 匿名 cookie)。admin 走会话行路径(visitorId 存
 * `admin:<sub>`);游客走 Redis 线程生命周期(不落行)。读侧验签最小实现
 * (readSessionUser 同款口径:验签通过即认,完整校验含 Redis jti 不在此处)。
 */
import type { NextRequest } from "next/server";

import { verifyAccessToken, ACCESS_COOKIE_NAME } from "@/lib/auth/session";
import { ADMIN_ROLE } from "@/lib/auth/constants";

import { attachVisitorCookie, resolveVisitorId } from "./visitor";

export type AgentIdentity =
  { kind: "admin"; key: string } | { kind: "guest"; key: string; fresh: boolean };

export async function resolveAgentIdentity(req: NextRequest): Promise<AgentIdentity> {
  const claims = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE_NAME)?.value);
  if (claims && claims.role === ADMIN_ROLE) {
    return { kind: "admin", key: `admin:${claims.sub}` };
  }
  const visitor = resolveVisitorId(req);
  return { kind: "guest", key: visitor.id, fresh: visitor.fresh };
}

/** fresh 游客在响应上补发 ah_av(admin 不依赖该 cookie) */
export function attachIdentityCookie(
  res: Parameters<typeof attachVisitorCookie>[0],
  identity: AgentIdentity,
): void {
  if (identity.kind === "guest" && identity.fresh) attachVisitorCookie(res, identity.key);
}
