/**
 * 守卫共用的会话半段(review P1 收敛):Origin 关 → 会话完整校验 → 记日志
 * 401。此前 mutation-guard 与 session-guard 各持一份逐字副本,且 mutation
 * 侧漏了 safe-method 豁免——同源 fetch GET 不带 Origin,导致 GET /api/posts
 * 会话通道必 403(与路由注释矛盾)。Origin 关只防 CSRF(写副作用),读请求
 * 无此面:GET/HEAD 豁免,写请求维持校验。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export type SessionClaimsResult =
  { kind: "ok"; sub: string } | { kind: "reject"; response: NextResponse };

export async function requireSessionClaims(req: NextRequest): Promise<SessionClaimsResult> {
  const safeMethod = req.method === "GET" || req.method === "HEAD";
  if (!safeMethod && !isSameOrigin(req)) {
    return { kind: "reject", response: apiEnvelope(403, "cross-origin forbidden") };
  }
  const claims = await requireAdminRequest(req);
  if (!claims) {
    logger.warn({ event: "authz.denied", path: new URL(req.url).pathname });
    return { kind: "reject", response: apiEnvelope(401, "unauthorized") };
  }
  return { kind: "ok", sub: claims.sub };
}
