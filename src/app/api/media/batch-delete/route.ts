/**
 * POST /api/media/batch-delete — 批量删除(孤儿处置,arch/08-media §3.2):
 * 逐条引用检查;有引用的跳过并在响应 skipped 中列出(原型「保留被引用的,删除孤儿」)。
 */
import { type NextRequest } from "next/server";

import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { mediaBatchDeleteSchema } from "@/lib/media/media-schema";
import { batchDeleteMedia, parseMediaId } from "@/lib/media/service";

import { mediaErrorResponse, requireAdminForMutation } from "../shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = mediaBatchDeleteSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const ids = parsed.data.ids.map((s) => parseMediaId(s)).filter((v): v is bigint => v !== null);
  if (ids.length === 0) return apiEnvelope(400, "没有合法的 id");

  try {
    const result = await batchDeleteMedia(ids);
    logger.info({ event: "media.batch_delete", ...result, skipped: result.skipped.length });
    return apiEnvelope(0, "ok", result);
  } catch (e) {
    return mediaErrorResponse(e);
  }
}
