/**
 * 任务绑定 API(M8 批⑥,arch/04 §4):四角色主力/备用台账;校验
 * (存在+启用+purposes 含角色、主力≠备用)不过返回 400/404/409。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { BindingUpdateSchema, listBindingsAdmin, updateBinding } from "@/lib/ai/bindings-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage AI service config";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const items = await listBindingsAdmin();
  return apiEnvelope(0, "ok", { items });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = BindingUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "绑定字段不合法(role/primaryId/backupId)");
  try {
    await updateBinding(parsed.data);
    return apiEnvelope(0, "saved", { items: await listBindingsAdmin() });
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
