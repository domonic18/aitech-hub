/** ASR 渠道配置 API(M8 批⑥):单例视图与更新;apiKey 留空 = 保留旧钥。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { AsrUpdateSchema, getAsrConfigAdmin, updateAsrConfig } from "@/lib/ai/asr-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage AI service config";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const config = await getAsrConfigAdmin();
  return apiEnvelope(0, "ok", { config });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = AsrUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "ASR 配置字段不合法(供应商/模型必填)");
  try {
    await updateAsrConfig(parsed.data);
    return apiEnvelope(0, "updated", { config: await getAsrConfigAdmin() });
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
