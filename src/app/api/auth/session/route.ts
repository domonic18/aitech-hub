/**
 * 当前会话查询(arch/05-services §3.1):客户端 hydrate 用;GET 安全方法不做 Origin 校验。
 * 顺带承担滑动续期:剩余有效期 <1d 时轮换新 Cookie(轮换 = 新 jti + 旧吊销,见 issuer)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { needsRenewal, readFullSessionUser, renewSession, sessionCookie } from "@/lib/auth/issuer";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const claims = await readFullSessionUser(req.headers.get("cookie"));
  if (!claims) {
    return apiEnvelope(0, "ok", { user: null });
  }

  const res = apiEnvelope(0, "ok", { user: { sub: claims.sub, role: claims.role } });
  if (needsRenewal(claims)) {
    res.cookies.set(sessionCookie(await renewSession(claims)));
  }
  return res;
}
