/**
 * GET /api/media/[id] — 详情抽屉数据(资产 kv + 引用方文章,arch/08-media §3.3)。
 * DELETE /api/media/[id] — 删除媒体(arch/08-media §4:必须过引用检查)。
 * 有引用 → 409 并列出引用方;无引用 → 软删入回收站(7 天后 audit 物理清退)。
 */
import { requireAdminRequest } from "@/lib/auth/guard";
import { type NextRequest } from "next/server";

import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { getMediaDetail } from "@/lib/media/queries";
import { deleteMedia, parseMediaId } from "@/lib/media/service";

import { mediaErrorResponse, requireAdminForMutation } from "../shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminRequest(req))) return apiEnvelope(401, "unauthorized");
  const { id: raw } = await ctx.params;
  const id = parseMediaId(raw);
  if (id === null) return apiEnvelope(400, "invalid id");

  const detail = await getMediaDetail(id);
  if (!detail) return apiEnvelope(404, "媒体不存在");
  const m = detail.media;
  return apiEnvelope(0, "ok", {
    media: {
      id: m.id.toString(),
      path: m.path,
      filename: m.filename,
      kind: m.kind,
      status: m.status,
      storage: m.storage,
      sizeBytes: m.sizeBytes === null ? null : Number(m.sizeBytes),
      width: m.width,
      height: m.height,
      sha1: m.sha1,
      thumbPath: m.thumbPath,
      createdAt: m.createdAt,
    },
    refs: detail.refs.map((p) => ({
      id: p.id.toString(),
      slug: p.slug,
      title: p.title,
      publishedAt: p.publishedAt,
    })),
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;
  const { id: raw } = await ctx.params;
  const id = parseMediaId(raw);
  if (id === null) return apiEnvelope(400, "invalid id");

  try {
    const { path } = await deleteMedia(id);
    logger.info({ event: "media.delete", id: raw });
    return apiEnvelope(0, "ok", { id: raw, path });
  } catch (e) {
    return mediaErrorResponse(e);
  }
}
