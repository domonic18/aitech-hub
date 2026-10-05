/**
 * POST /api/media/dupes/merge — 重复组合并(原型「保留 1 个并合并引用」,
 * 2026-10-06 验收反馈问题1):keeper 取组内最早一条,引用改指后其余副本软删。
 */
import { type NextRequest } from "next/server";

import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { mediaDupeMergeSchema } from "@/lib/media/media-schema";
import { mergeDupeGroup } from "@/lib/media/service";

import { mediaErrorResponse, requireAdminForMutation } from "../../shared";

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
  const parsed = mediaDupeMergeSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }

  try {
    const result = await mergeDupeGroup(parsed.data.sha1);
    logger.info({ event: "media.dupe_merged", sha1: parsed.data.sha1, ...result });
    return apiEnvelope(0, "ok", result);
  } catch (e) {
    return mediaErrorResponse(e);
  }
}
