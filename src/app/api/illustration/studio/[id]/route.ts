/**
 * 配图工坊取数 API(M40 批 B):版本 + 根→当前链 + 最新图层组(含图层行)。
 * 编辑器轮询此口等拆层完成(processing → ready/failed)。仅会话通道
 * (PAT 不能驱动编辑器,同 cover 候选口径)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { getStudioView } from "@/lib/ai/illustration-studio";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT 不能访问配图工坊(仅管理会话通道)");
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const versionId = BigInt(/^\d+$/.test(id) ? id : "0");
  const view = await getStudioView(versionId);
  if (!view) return apiEnvelope(404, "工坊版本不存在");
  return apiEnvelope(0, "ok", view);
}
