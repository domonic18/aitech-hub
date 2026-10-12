/**
 * 候选人工终审 API(M25 批③治理台):PUT { status: approved|rejected|pending }。
 * approved=终审通过(博主候选后续由人工至「博主管理」登记,候选表是发现侧
 * 唯一系统出口);pending 供回退重审。重复发现刷新不动终审结论(仓储语义)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { setCandidateStatus } from "@/lib/discovery/candidates";
import { CANDIDATE_STATUSES } from "@/lib/discovery/status";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage discovery candidates";

const Body = z.object({ status: z.enum(CANDIDATE_STATUSES) });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "status 不合法");
  try {
    const row = await setCandidateStatus(BigInt(id), parsed.data.status);
    return apiEnvelope(0, "ok", { id: row.id.toString(), status: row.status });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return apiEnvelope(404, "候选不存在");
    }
    throw e;
  }
}
