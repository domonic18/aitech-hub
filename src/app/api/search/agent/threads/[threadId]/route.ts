/**
 * 删除会话(K2.5;K2.6 身份分流):admin 归属校验(非本人/不存在一律 404
 * 不泄露存在性)→ 行+checkpoint 同删;游客解绑 Redis 归属键 + checkpoint
 * 同删(键已在则 404——过期自愈由前端开新会话)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { deleteSession } from "@/lib/agent/sessions";
import { deleteThread } from "@/lib/agent/checkpointer";
import { isGuestThreadId, unbindGuestThread } from "@/lib/agent/guest-threads";
import { resolveAgentIdentity } from "@/lib/agent/identity";
import { isSameOrigin } from "@/lib/http/origin";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<NextResponse> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const { threadId } = await params;
  const identity = await resolveAgentIdentity(req);
  if (identity.kind === "guest") {
    if (!isGuestThreadId(threadId)) return apiEnvelope(404, "会话不存在");
    if (!(await unbindGuestThread(threadId, identity.key))) return apiEnvelope(404, "会话不存在");
    try {
      await deleteThread(threadId);
    } catch {
      // checkpoint 残留由游客日清兜底再扫
    }
    logger.info({ event: "agent.guest_thread_deleted", threadId });
    return apiEnvelope(0, "ok");
  }
  const deleted = await deleteSession(identity.key, threadId);
  if (!deleted) return apiEnvelope(404, "会话不存在");
  logger.info({ event: "agent.session_deleted", threadId });
  return apiEnvelope(0, "ok");
}
