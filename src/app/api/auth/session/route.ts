/**
 * 当前会话查询(arch/05-services §3.1):客户端 hydrate 用;GET 安全方法不做 Origin 校验。
 * 顺带承担滑动续期:剩余有效期 <1d 时轮换新 Cookie(轮换 = 新 jti + 旧吊销,见 issuer)。
 * M22 批②:扩返回账号中心展示面(nickname/avatarPath/assistantVisible)——
 * HeaderSession 头像下拉与批④ FAB 显隐共用本次取数,不另开端点。
 */
import { type NextRequest, NextResponse } from "next/server";

import { needsRenewal, readFullSessionUser, renewSession, sessionCookie } from "@/lib/auth/issuer";
import { prisma } from "@/lib/db";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const claims = await readFullSessionUser(req.headers.get("cookie"));
  if (!claims) {
    return apiEnvelope(0, "ok", { user: null });
  }

  // 展示面缺列不反噬会话:账号偶发缺失(理论级联删兜不住的脏数据)回退 null 值
  const account = await prisma.userAccount
    .findUnique({
      where: { id: BigInt(claims.sub) },
      select: { nickname: true, avatarPath: true, assistantVisible: true },
    })
    .catch(() => null);

  const res = apiEnvelope(0, "ok", {
    user: {
      sub: claims.sub,
      role: claims.role,
      nickname: account?.nickname ?? null,
      avatarPath: account?.avatarPath ?? null,
      assistantVisible: account?.assistantVisible ?? true,
    },
  });
  if (needsRenewal(claims)) {
    res.cookies.set(sessionCookie(await renewSession(claims)));
  }
  return res;
}
