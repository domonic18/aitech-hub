/**
 * /api/media — 图片上传(POST)与编辑器选图清单(GET 窄口)。
 * POST(arch/08-media §3.4,admin + Origin 三关):multipart file → 白名单/大小
 * 校验(service)→ sha1 入库 → enqueue sharp 管线,202 + mediaId(处理中;
 * WebP/缩略图就绪后媒体库可见)。视频不经应用服务器(STS 直传 COS 二期交付),
 * service 侧白名单显式拒绝视频 mime。
 * GET(2026-10-15 验收反馈问题三):编辑器「从媒体库插入」选图清单,只出
 * 缩略图已就绪的图片,分页/文件名搜索;读侧守卫,不走 listMediaAdmin 重列表。
 */
import { type NextRequest } from "next/server";

import { parsePage } from "@/lib/admin/list";
import { requireAdminRequest } from "@/lib/auth/guard";
import { requireAdminActor } from "@/lib/http/mutation-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { UPLOAD_FIELD } from "@/lib/media/media-schema";
import { listImagesForPicker } from "@/lib/media/picker";
import { uploadMedia } from "@/lib/media/service";

import { mediaErrorResponse } from "./shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdminRequest(req);
  if (!admin) return apiEnvelope(401, "unauthorized");
  const sp = new URL(req.url).searchParams;
  if ((sp.get("scope") ?? "picker") !== "picker") return apiEnvelope(400, "unknown scope");
  const result = await listImagesForPicker({
    q: sp.get("q")?.trim() || undefined,
    page: parsePage(sp.get("page") ?? undefined),
  });
  return apiEnvelope(0, "ok", result);
}

export async function POST(req: NextRequest) {
  // 单次双路鉴权(requireAdminForMutation 的展开形态):actor 供上传审计归因
  const actorGuard = await requireAdminActor(req);
  if (!actorGuard.ok) return actorGuard.response;
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
    logger.info({
      event: "media.upload",
      actor: actorGuard.actor,
      id: saved.id,
      reused: saved.reused,
    });
    return apiEnvelope(0, saved.reused ? "reused" : "accepted", saved, 202);
  } catch (e) {
    return mediaErrorResponse(e);
  }
}
