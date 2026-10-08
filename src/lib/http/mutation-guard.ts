/**
 * mutation 类 Route Handler 共用守卫(arch/07-frontend §4):
 * 双通道鉴权(M5-c)——
 *  - 带 Authorization 头 → 只走 PAT 路(verifyPatToken)。Bearer 非浏览器
 *    凭证,不存在 CSRF 搭车面,故跳过 Origin 关;失败一律 401。
 *  - 无该头 → 会话半段(requireSessionClaims:Origin 关,GET/HEAD 豁免;
 *    会话完整校验;失败 401)。
 * requireAdminForMutation 签名不变,既有 mutation 路由零改动自动获得双路。
 * 需要区分 actor 的调用方(requirement §3.6 审计)改用 requireAdminActor。
 */
import { type NextRequest, NextResponse } from "next/server";

import { verifyPatToken } from "@/lib/auth/pat";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

import { requireSessionClaims } from "./session-claims";

/** 通过守卫的操作者:会话(JWT)或 PAT(requirement §3.6 审计锚) */
export type AdminActor =
  { kind: "session"; sub: string } | { kind: "pat"; sub: string; patId: string };

export type ActorGuardResult =
  { ok: true; actor: AdminActor } | { ok: false; response: NextResponse };

export async function requireAdminActor(req: NextRequest): Promise<ActorGuardResult> {
  const authorization = req.headers.get("authorization");
  if (authorization !== null) {
    const pat = await verifyPatToken(authorization);
    if (!pat) {
      logger.warn({ event: "authz.denied", via: "pat", path: new URL(req.url).pathname });
      return { ok: false, response: apiEnvelope(401, "invalid token") };
    }
    return { ok: true, actor: { kind: "pat", sub: pat.sub, patId: pat.patId } };
  }

  const claims = await requireSessionClaims(req);
  if (claims.kind === "reject") return { ok: false, response: claims.response };
  return { ok: true, actor: { kind: "session", sub: claims.sub } };
}

/** 兼容形态:不关心 actor 的调用方维持原用法(通过返 null,失败返响应) */
export async function requireAdminForMutation(req: NextRequest): Promise<NextResponse | null> {
  const result = await requireAdminActor(req);
  return result.ok ? null : result.response;
}
