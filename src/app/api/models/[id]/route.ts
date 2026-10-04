/** 模型更新与删除(M8 批⑥):apiKey 留空 = 保留旧钥;被任务绑定引用 → 409 先解绑。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { AiModelCreateSchema, deleteAiModel, updateAiModel } from "@/lib/ai/models-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage AI service config";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = AiModelCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "模型字段不合法(名称/模型 ID/用途必填)");
  try {
    const r = await updateAiModel(Number(id), parsed.data);
    return apiEnvelope(0, "updated", r);
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  try {
    await deleteAiModel(Number(id));
    return apiEnvelope(0, "deleted");
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
