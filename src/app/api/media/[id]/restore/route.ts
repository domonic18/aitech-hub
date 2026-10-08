/**
 * POST /api/media/[id]/restore — 回收站恢复(2026-10-08 回收站视图):
 * 清 deletedAt,status 按实时引用口径重算(active/orphan);文件在回收站窗口内
 * 未被清退,恢复即原 URL 复活零拷贝。不在回收站的行 404。
 */
import { type NextRequest } from "next/server";

import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { parseMediaId, restoreMedia } from "@/lib/media/service";

import { mediaErrorResponse, requireAdminForMutation } from "../../shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const { id: raw } = await ctx.params;
  const id = parseMediaId(raw);
  if (id === null) return apiEnvelope(400, "invalid id");

  try {
    const result = await restoreMedia(id);
    logger.info({ event: "media.restore", id: raw, status: result.status });
    return apiEnvelope(0, "ok", result);
  } catch (e) {
    return mediaErrorResponse(e);
  }
}
