/**
 * 发现候选 API(M25 批③治理台):GET 列表(终审分段+分页+状态计数)。
 * BigInt 已字符串化;仅会话通道(PAT 不得操纵发现候选)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { parseListSegment, parsePage } from "@/lib/admin/list";
import { listCandidatesAdmin } from "@/lib/discovery/admin";
import { CANDIDATE_LIST_SEGMENTS } from "@/lib/discovery/status";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage discovery candidates";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const sp = req.nextUrl.searchParams;
  const result = await listCandidatesAdmin({
    segment: parseListSegment(CANDIDATE_LIST_SEGMENTS, sp.get("status") ?? undefined, "all"),
    page: parsePage(sp.get("page") ?? undefined),
  });
  return apiEnvelope(0, "ok", result);
}
