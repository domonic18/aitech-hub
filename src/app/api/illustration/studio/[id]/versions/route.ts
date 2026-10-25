/**
 * 配图工坊·编辑候选确认成版本 API(M40 批 B):预览态确认制的落笔步——
 * 候选整图(已入媒体库)沿 parent 单链追加为新版本,版本号即编辑评审史。
 * 仅会话通道。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import {
  EDIT_ORIGINS,
  confirmEditVersion,
  isValidNormalizedBbox,
} from "@/lib/ai/illustration-studio";
import { SITE_UPLOADS_PREFIX } from "@/lib/media/refs";

export const dynamic = "force-dynamic";

const ConfirmSchema = z.object({
  imagePath: z.string().trim().max(500).startsWith(SITE_UPLOADS_PREFIX, "候选图须为站内媒体路径"),
  origin: z.enum(EDIT_ORIGINS),
  instruction: z.string().trim().max(1000).optional(),
  bbox: z.string().trim().max(40).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT 不能驱动编辑器(仅管理会话通道)");
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "版本 ID 不合法");
  const parsed = ConfirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "确认参数不合法(imagePath/origin 必填)");
  if (parsed.data.bbox !== undefined && !isValidNormalizedBbox(parsed.data.bbox)) {
    return apiEnvelope(400, 'bbox 坐标须为 normalized "x1 y1 x2 y2"(0-999)');
  }
  try {
    const r = await confirmEditVersion(bigId, {
      imagePath: parsed.data.imagePath,
      origin: parsed.data.origin,
      instruction: parsed.data.instruction,
      bbox: parsed.data.bbox,
    });
    return apiEnvelope(0, "created", { versionId: Number(r.versionId) });
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
