/**
 * ASR 连通性测试(M8 批⑥):1s 正弦波实调转写(转写文本为空属成功),
 * 结果落 last_test 四件套;skipped(不支持的协议)不覆盖既有结果。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { getAsrForTest, recordAsrTest } from "@/lib/ai/asr-admin";
import { probeAsr } from "@/lib/ai/probe";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage AI service config";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  try {
    const target = await getAsrForTest();
    const result = await probeAsr(target);
    await recordAsrTest(result);
    return apiEnvelope(0, result.ok ? "ok" : "fail", result);
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    throw e;
  }
}
