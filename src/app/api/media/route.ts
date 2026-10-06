/**
 * POST /api/media — 图片上传(arch/08-media §3.4,admin + Origin 三关):
 * multipart file → 白名单/大小校验(service)→ sha1 入库 → enqueue sharp 管线,
 * 202 + mediaId(处理中;WebP/缩略图就绪后媒体库可见)。
 * 视频不经应用服务器(STS 直传 COS 二期交付),service 侧白名单显式拒绝视频 mime。
 */
import { type NextRequest } from "next/server";

import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { UPLOAD_FIELD } from "@/lib/media/media-schema";
import { uploadMedia } from "@/lib/media/service";

import { mediaErrorResponse, requireAdminForMutation } from "./shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  try {
    // 畸形 multipart(截断/伪造边界)→ 400 客户端错,不落 media.write.fail 日志
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return apiEnvelope(400, "invalid multipart body");
    }
    const file = form.get(UPLOAD_FIELD);
    if (!(file instanceof File)) {
      return apiEnvelope(400, `缺少文件字段 ${UPLOAD_FIELD}`);
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const saved = await uploadMedia({
      data,
      mime: file.type || "application/octet-stream",
      filename: file.name || "upload",
    });
    logger.info({ event: "media.upload", id: saved.id, reused: saved.reused });
    return apiEnvelope(0, saved.reused ? "reused" : "accepted", saved, 202);
  } catch (e) {
    return mediaErrorResponse(e);
  }
}
