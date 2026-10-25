/** Agent skill 更新与删除(M30 批①):key 建后不可改;物理删,软引用随删降级。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseNumericId } from "@/lib/http/parse-id";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import {
  AgentSkillUpdateSchema,
  deleteAgentSkill,
  updateAgentSkill,
} from "@/lib/ai/agent-skills-admin";
import { AI_CONFIG_PAT_DENY } from "@/lib/ai/constants";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, AI_CONFIG_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const nid = parseNumericId(id);
  if (nid === null) return apiEnvelope(400, "invalid id");
  const parsed = AgentSkillUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "技能字段不合法(名称/场景/正文必填)");
  try {
    const r = await updateAgentSkill(nid, parsed.data);
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
  const actor = await requireSessionActor(req, AI_CONFIG_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const nid = parseNumericId(id);
  if (nid === null) return apiEnvelope(400, "invalid id");
  try {
    await deleteAgentSkill(nid);
    return apiEnvelope(0, "deleted");
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
