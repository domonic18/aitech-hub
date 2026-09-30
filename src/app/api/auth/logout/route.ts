/**
 * 登出(arch/05-services §3.1):吊销 Redis jti 登记 + 清 Cookie;幂等(无会话也 ok)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { readFullSessionUser, revokeSession, sessionCookie } from "@/lib/auth/issuer";
import { logger } from "@/lib/logger";
import { isSameOrigin } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

function envelope(code: number, message: string): NextResponse {
  return NextResponse.json({ code, message, data: null }, { status: code === 0 ? 200 : code });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return envelope(403, "cross-origin forbidden");

  const claims = await readFullSessionUser(req.headers.get("cookie"));
  if (claims) {
    await revokeSession(claims.jti);
    logger.info({ event: "auth.logout", sub: claims.sub });
  }

  const res = envelope(0, "ok");
  res.cookies.set(sessionCookie("")); // maxAge 0 清除
  return res;
}
