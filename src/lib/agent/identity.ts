/**
 * Agent 身份三路分流(M22 批④扩,K2.6 原两路):admin(ah_at role=admin)、
 * user(ah_at 普通用户,M22 起不再是游客——会话行走行路径,visitorId 存
 * `user:<sub>`,余额扣减链路见 stream 路由)、游客(ah_av 匿名 cookie,
 * Redis 线程生命周期不落行)。读侧验签最小实现(verifyAccessToken 同款
 * 口径:验签通过即认,完整校验含 Redis jti 不在此处)。
 */
import type { NextRequest } from "next/server";

import { verifyAccessToken, ACCESS_COOKIE_NAME } from "@/lib/auth/session";
import { ADMIN_ROLE } from "@/lib/auth/constants";

import { attachVisitorCookie, resolveVisitorId } from "./visitor";

export type AgentIdentity =
  | { kind: "admin"; key: string }
  | { kind: "user"; key: string; userId: bigint }
  | { kind: "guest"; key: string; fresh: boolean };

/** 登录身份共享会话行路径(admin/user 同构,visitorId 前缀区分人群) */
export function isMemberIdentity(
  identity: AgentIdentity,
): identity is Exclude<AgentIdentity, { kind: "guest" }> {
  return identity.kind !== "guest";
}

export async function resolveAgentIdentity(req: NextRequest): Promise<AgentIdentity> {
  const claims = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE_NAME)?.value);
  if (claims) {
    if (claims.role === ADMIN_ROLE) {
      return { kind: "admin", key: `admin:${claims.sub}` };
    }
    return { kind: "user", key: `user:${claims.sub}`, userId: BigInt(claims.sub) };
  }
  const visitor = resolveVisitorId(req);
  return { kind: "guest", key: visitor.id, fresh: visitor.fresh };
}

/** fresh 游客在响应上补发 ah_av(登录身份不依赖该 cookie) */
export function attachIdentityCookie(
  res: Parameters<typeof attachVisitorCookie>[0],
  identity: AgentIdentity,
): void {
  if (identity.kind === "guest" && identity.fresh) attachVisitorCookie(res, identity.key);
}
