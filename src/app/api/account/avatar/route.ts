/**
 * POST /api/account/avatar — 头像上传(M22 批②,需求10):登录用户守卫 +
 * Origin;jpg/png/webp ≤2MB,复用 uploadMedia 管线(sha1 去重/sharp 管线),
 * 成功后写 user_account.avatar_path。旧头像文件不删(媒体库归档口径)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { verifyAccessToken, ACCESS_COOKIE_NAME } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { AccountError, changeAvatar } from "@/lib/users/account-profile";
import { UPLOAD_FIELD } from "@/lib/media/media-schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const session = await verifyAccessToken(req.cookies.get(ACCESS_COOKIE_NAME)?.value);
  if (!session) return apiEnvelope(401, "请先登录");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiEnvelope(400, "invalid multipart body");
  }
  const file = form.get(UPLOAD_FIELD);
  if (!(file instanceof File)) return apiEnvelope(400, `缺少文件字段 ${UPLOAD_FIELD}`);

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const { avatarPath } = await changeAvatar(BigInt(session.sub), {
      data,
      mime: file.type || "application/octet-stream",
      filename: file.name || "avatar",
    });
    return apiEnvelope(0, "ok", { avatarPath });
  } catch (e) {
    if (e instanceof AccountError) {
      if (e.code === "unsupported") return apiEnvelope(415, e.message);
      if (e.code === "too_large") return apiEnvelope(413, e.message);
      if (e.code === "not_found") return apiEnvelope(404, e.message);
    }
    throw e;
  }
}
