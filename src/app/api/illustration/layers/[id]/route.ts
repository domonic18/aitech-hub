/**
 * 配图工坊·图层显隐 API(M40 批 B):显隐组合的持久化开关(导出在编辑器
 * 前端画布按 z 序合成底板+可见层)。仅会话通道。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { setLayerVisible } from "@/lib/ai/illustration-studio";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({ visible: z.boolean() });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, "PAT 不能驱动编辑器(仅管理会话通道)");
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "图层 ID 不合法");
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "参数不合法(visible 布尔必填)");
  try {
    await setLayerVisible(bigId, parsed.data.visible);
    return apiEnvelope(0, "ok");
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
