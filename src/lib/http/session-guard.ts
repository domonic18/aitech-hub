/**
 * 会话专用守卫(M5-c):管理面端点只走会话,不走 PAT——PAT 是发布域凭证,
 * 与 mutation-guard 的 Bearer 双路正好相反:Authorization 头在场一律 403,
 * 会话半段复用 requireSessionClaims(review P1 收敛,Origin 关含 safe-method
 * 豁免)。通过返回 claims,失败返回 reject(调用方按 kind 判别)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { apiEnvelope } from "@/lib/http/response";

import { requireSessionClaims, type SessionClaimsResult } from "./session-claims";

export type SessionGuardResult = SessionClaimsResult;

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
  return requireSessionClaims(req);
}
