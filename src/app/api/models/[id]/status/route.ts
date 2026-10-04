/** 模型启停(M8 批⑥):行内一键切换;停用后解析层跳过并回落备用。 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { setAiModelEnabled } from "@/lib/ai/models-admin";
import { AI_CONFIG_PAT_DENY } from "@/lib/ai/constants";

export const dynamic = "force-dynamic";

const Body = z.object({ enabled: z.boolean() });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, AI_CONFIG_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "enabled 须为布尔");
  try {
    await setAiModelEnabled(Number(id), parsed.data.enabled);
    return apiEnvelope(0, parsed.data.enabled ? "enabled" : "disabled");
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
