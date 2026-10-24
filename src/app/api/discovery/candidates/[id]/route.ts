/**
 * 候选人工终审 API(M25 批③治理台):PUT { status: approved|rejected|pending }。
 * approved=终审通过;pending 供回退重审。重复发现刷新不动终审结论(仓储语义)。
 * 批准博主候选时自动登记进博主管理(M26 批③追加,2026-10-12 拍板:同步
 * upsert social_account,幂等跳过已登记;登记失败仅附行内提示,终审不受阻,
 * 回退待定再批准可重试)——出参 socialAccountId 附登记结果。
 */
import { type NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { setCandidateStatus } from "@/lib/discovery/candidates";
import { registerApprovedBlogger } from "@/lib/discovery/blogger-registration";
import { CANDIDATE_STATUSES } from "@/lib/discovery/status";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";

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
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "status 不合法");
  try {
    const row = await setCandidateStatus(bigId, parsed.data.status);
    // 批准博主候选 → 同步自动登记进博主管理(幂等;失败转行内提示不阻塞终审)
    let message = "ok";
    let socialAccountId: string | null = null;
    if (parsed.data.status === "approved" && row.type === "blogger") {
      const reg = await registerApprovedBlogger(row);
      if (reg.outcome !== "failed") socialAccountId = String(reg.socialAccountId);
      message =
        reg.outcome === "created"
          ? "已批准;已自动登记进博主管理(启用,进入采集轮询)"
          : reg.outcome === "exists"
            ? "已批准;该博主已在博主管理,跳过重复登记"
            : `已批准;自动登记失败:${reg.message}(可回退待定后重新批准重试)`;
    }
    return apiEnvelope(0, message, { id: row.id.toString(), status: row.status, socialAccountId });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return apiEnvelope(404, "候选不存在");
    }
    throw e;
  }
}
