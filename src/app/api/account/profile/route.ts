/**
 * PATCH /api/account/profile — 自助资料修改(M22 批②):昵称/简介。
 * 登录用户守卫(verifyAccessToken 单一契约)+ Origin 校验,同 pay/orders 惯例。
 */
import { type NextRequest, NextResponse } from "next/server";

import { verifyAccessToken, ACCESS_COOKIE_NAME } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { AccountError, profileUpdateSchema, updateProfile } from "@/lib/users/account-profile";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE_NAME)?.value);
  if (!session) return apiEnvelope(401, "请先登录");

  const parsed = profileUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "昵称 2-20 字,简介不超过 500 字");

  try {
    const profile = await updateProfile(BigInt(session.sub), parsed.data);
    return apiEnvelope(0, "ok", profile);
  } catch (e) {
    if (e instanceof AccountError && e.code === "not_found") return apiEnvelope(404, e.message);
    throw e;
  }
}
