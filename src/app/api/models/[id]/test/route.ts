/**
 * 模型连通性测试(M8 批⑥,arch/04 §4「测试连通性入口」):探针内部解密取钥,
 * 结果落 last_test 四件套;probe 永不 throw,skipped(不支持的协议)不覆盖既有结果。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { getModelForTest, recordModelTest } from "@/lib/ai/models-admin";
import { probeLlm } from "@/lib/ai/probe";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage AI service config";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  try {
    const target = await getModelForTest(Number(id));
    const result = await probeLlm(target);
    await recordModelTest(Number(id), result);
    return apiEnvelope(0, result.ok ? "ok" : "fail", result);
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
