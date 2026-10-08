/**
 * 后台会话详情 API(K2.6 需求5):meta 统计 + checkpoint 消息时间线。
 * 游客过期(归属键消失)只返 meta 且 expired=true,前端标「已过期」。
 */
import { type NextRequest, NextResponse } from "next/server";

import { getAgentSessionDetail } from "@/lib/agent/admin-sessions";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage agent sessions";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { threadId } = await params;
  const detail = await getAgentSessionDetail(threadId);
  if (!detail) return apiEnvelope(404, "会话不存在");
  return apiEnvelope(0, "ok", detail);
}
