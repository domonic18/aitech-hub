/**
 * 配图工坊·手动拆层/重拆 API(M40 批 B):对当前版本触发一次拆层运行
 * (BullMQ,~75s;同版本已有 processing 组 409 人话拒)。改字确认后旧组
 * 过期,重拆即调本口(M40 决策「改字后手动重拆」)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { enqueueDecompose } from "@/lib/ai/illustration-studio";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT 不能触发拆层(仅管理会话通道)");
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "版本 ID 不合法");
  try {
    const r = await enqueueDecompose(bigId);
    return apiEnvelope(0, "accepted", { groupId: Number(r.groupId) });
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
