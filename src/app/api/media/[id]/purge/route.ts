/**
 * DELETE /api/media/[id]/purge — 回收站立即清除(2026-10-08 回收站视图):
 * 物理删除文件家族(main/webp/thumb,经 MediaStorage → COS/local)与记录,
 * 绕过 7 天回收站等待;admin 显式动作,与 audit 定时清退共用 purgeDeletedMedia。
 */
import { type NextRequest } from "next/server";

import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { parseMediaId, purgeMedia } from "@/lib/media/service";

import { mediaErrorResponse, requireAdminForMutation } from "../../shared";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const { id: raw } = await ctx.params;
  const id = parseMediaId(raw);
  if (id === null) return apiEnvelope(400, "invalid id");

  try {
    const result = await purgeMedia(id);
    logger.info({ event: "media.purge", id: raw });
    return apiEnvelope(0, "ok", result);
  } catch (e) {
    return mediaErrorResponse(e);
  }
}
