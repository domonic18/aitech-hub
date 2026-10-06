/**
 * 删除会话(K2.5):归属校验(非本人/不存在一律 404 不泄露存在性)→
 * 行+checkpoint 同删(30 天日清兜底残扫)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { deleteSession } from "@/lib/agent/sessions";
import { resolveVisitorId } from "@/lib/agent/visitor";
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
  const visitor = resolveVisitorId(req);
  const deleted = await deleteSession(visitor.id, threadId);
  if (!deleted) return apiEnvelope(404, "会话不存在");
  logger.info({ event: "agent.session_deleted", threadId });
  return apiEnvelope(0, "ok");
}
