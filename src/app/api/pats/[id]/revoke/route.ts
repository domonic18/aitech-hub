/**
 * PAT 吊销 API(M5-c):仅会话通道(同 /api/pats)。幂等:已吊销返回 already。
 */
import { type NextRequest, NextResponse } from "next/server";

import { revokePatById } from "@/lib/auth/pat";
import { apiEnvelope } from "@/lib/http/response";
import { requireSessionActor } from "@/lib/http/session-guard";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT must not mint PATs");
  if (actor.kind === "reject") return actor.response;

  const { id } = await params;
  const result = await revokePatById(id);
  if (result === "missing") return apiEnvelope(404, "令牌不存在");
  return apiEnvelope(0, result);
}
