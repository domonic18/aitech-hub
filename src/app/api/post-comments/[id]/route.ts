/**
 * 评论治理 admin API(M23 批③):PUT 隐藏/恢复流转(commentStatusSchema 两态
 * 互切);DELETE 物理删——连带直接子与点赞行(两级封顶 ⇒ 收集即完备),不可逆。
 * 会话鉴权(requireAdminRequest,PAT 拒);不存在 404;操作者进审计日志。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { commentStatusSchema } from "@/lib/comment/comment-schema";
import {
  deleteCommentWithReplies,
  requireComment,
  updateCommentStatus,
} from "@/lib/comment/comment-admin";
import { commentDomainErrorStatus } from "@/lib/comment/http-map";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const admin = await requireAdminRequest(req);
  if (!admin) return apiEnvelope(401, "unauthorized");

  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = commentStatusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "invalid body");
  }

  try {
    await requireComment(BigInt(id));
    const item = await updateCommentStatus(BigInt(id), parsed.data.status);
    logger.info({
      event: "admin.comment.status_changed",
      operatorId: admin.sub,
      commentId: id,
      status: parsed.data.status,
    });
    return apiEnvelope(0, "ok", { item });
  } catch (e) {
    const status = commentDomainErrorStatus(e);
    if (status === null) throw e;
    return apiEnvelope(status, e instanceof Error ? e.message : "error");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const admin = await requireAdminRequest(req);
  if (!admin) return apiEnvelope(401, "unauthorized");

  const { id } = await params;
  if (!/^\d+$/.test(id)) return apiEnvelope(400, "invalid id");

  try {
    await requireComment(BigInt(id));
    const { deleted } = await deleteCommentWithReplies(BigInt(id));
    logger.info({
      event: "admin.comment.deleted",
      operatorId: admin.sub,
      commentId: id,
      deleted,
    });
    return apiEnvelope(0, "ok", { deleted });
  } catch (e) {
    const status = commentDomainErrorStatus(e);
    if (status === null) throw e;
    return apiEnvelope(status, e instanceof Error ? e.message : "error");
  }
}
