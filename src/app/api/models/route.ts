/**
 * 模型台账 API(M8 批⑥,arch/04 §4):列表与新增。模型台账承载 AI 服务
 * 接入凭据,仅会话通道(PAT 不得管理 AI 服务配置,同 bloggers/channels 口径)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { AiModelCreateSchema, createAiModel, listModelsAdmin } from "@/lib/ai/models-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage AI service config";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const items = await listModelsAdmin();
  return apiEnvelope(0, "ok", { items });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = AiModelCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "模型字段不合法(名称/模型 ID/用途必填)");
  try {
    const r = await createAiModel(parsed.data);
    return apiEnvelope(0, "created", r);
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
