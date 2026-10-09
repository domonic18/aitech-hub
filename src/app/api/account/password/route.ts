/**
 * POST /api/account/password — 自助密码修改(M22 批②):旧密码必验 +
 * validatePassword 边界,bcrypt 12 同注册。无密码账号(历史迁移用户)走
 * 忘记密码链,不在本口放行。
 */
import { type NextRequest, NextResponse } from "next/server";

import { verifyAccessToken, ACCESS_COOKIE_NAME } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { AccountError, changePassword, passwordChangeSchema } from "@/lib/users/account-profile";

export const dynamic = "force-dynamic";

const ERROR_STATUS = {
  not_found: 404,
  wrong_password: 400,
  no_password: 409,
  invalid_new_password: 400,
} as const satisfies Partial<Record<AccountError["code"], number>>;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE_NAME)?.value);
  if (!session) return apiEnvelope(401, "请先登录");

  const parsed = passwordChangeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "invalid body");

  try {
    await changePassword(BigInt(session.sub), parsed.data);
    return apiEnvelope(0, "密码已更新");
  } catch (e) {
    if (e instanceof AccountError && e.code in ERROR_STATUS) {
      return apiEnvelope(ERROR_STATUS[e.code as keyof typeof ERROR_STATUS], e.message);
    }
    throw e;
  }
}
