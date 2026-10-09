/**
 * 悬浮助手显隐(M22 批④,需求7):账号级开关(跨设备一致),session API
 * 下发。游客显隐走 localStorage 不落库,不经过此端点。
 */
import { type NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE_NAME, verifyAccessToken } from "@/lib/auth/session";
import { assistantVisibleSchema } from "@/lib/users/account-schema";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE_NAME)?.value);
  if (!session) return apiEnvelope(401, "unauthorized");

  const parsed = assistantVisibleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body");

  await prisma.userAccount.update({
    where: { id: BigInt(session.sub) },
    data: { assistantVisible: parsed.data.visible },
  });
  return apiEnvelope(0, "ok", { visible: parsed.data.visible });
}
