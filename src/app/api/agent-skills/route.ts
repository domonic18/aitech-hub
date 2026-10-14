/**
 * Agent skill API(M30 批①,arch/04):列表与新增。技能承载 agent 流程纪律,
 * 仅会话通道(PAT 不得管理 AI 服务配置,同 models 口径)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import {
  AgentSkillCreateSchema,
  createAgentSkill,
  listSkillsAdmin,
} from "@/lib/ai/agent-skills-admin";
import { AI_CONFIG_PAT_DENY } from "@/lib/ai/constants";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, AI_CONFIG_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const items = await listSkillsAdmin();
  return apiEnvelope(0, "ok", { items });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, AI_CONFIG_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = AgentSkillCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "技能字段不合法(key/名称/场景/正文必填)");
  try {
    const r = await createAgentSkill(parsed.data);
    return apiEnvelope(0, "created", r);
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
