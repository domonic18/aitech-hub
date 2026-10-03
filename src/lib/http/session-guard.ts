/**
 * 会话专用守卫(M5-c):管理面端点只走会话,不走 PAT——PAT 是发布域凭证,
 * 与 mutation-guard 的 Bearer 双路正好相反:Authorization 头在场一律 403,
 * 再过 Origin 与 admin 会话。通过返回 claims,失败返回 reject(调用方按
 * kind 判别)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export type SessionGuardResult =
  { kind: "ok"; sub: string } | { kind: "reject"; response: NextResponse };

/**
 * @param patDenyMessage PAT 到场的拒绝文案(端点各异:PAT 不能发 PAT / 不能管用户)
 */
export async function requireSessionActor(
  req: NextRequest,
  patDenyMessage: string,
): Promise<SessionGuardResult> {
  if (req.headers.get("authorization") !== null) {
    return { kind: "reject", response: apiEnvelope(403, patDenyMessage) };
  }
  // Origin 关只防 CSRF(写副作用);同源 GET fetch 不带 Origin 头,读接口不设此关
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
