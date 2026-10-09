/**
 * 反馈 admin API — 状态流转(M22 批⑤,需求9):PUT 整行覆盖 status +
 * adminNote(状态机 open → processing → resolved,可回退重开,值域由
 * feedbackUpdateSchema 约束)。不存在的 id 404(FeedbackAdminError 映射);
 * 操作者只进审计日志,不落反馈行(无 operator 列,grant 路由同纪律)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { feedbackUpdateSchema } from "@/lib/feedback/feedback-schema";
import {
  FeedbackAdminError,
  requireFeedback,
  updateFeedbackStatus,
} from "@/lib/feedback/feedback-admin";
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

  const parsed = feedbackUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "invalid body");
  }

  try {
    await requireFeedback(BigInt(id));
  } catch (e) {
    if (e instanceof FeedbackAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
  const item = await updateFeedbackStatus(BigInt(id), parsed.data.status, parsed.data.adminNote);
  logger.info({
    event: "admin.feedback.status_changed",
    operatorId: admin.sub,
    feedbackId: id,
    status: parsed.data.status,
  });
  return apiEnvelope(0, "ok", { item });
}
