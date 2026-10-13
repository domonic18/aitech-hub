/**
 * 专题合成 API(M26 批④建;M27 批③ agent 化改异步,方案 §5/§8):POST 资格
 * 预检后入队(QUEUE_TOPIC_COMPOSE,202)→ worker 四步管线(角度择优→起草→
 * 自检→修订,失败自动降级单调用)→ 落稿锚定;GET 凭确定性 jobId 轮询进度
 * (idle/queued/running/done/failed)。重合成保护(§10-3):关联文档被人工
 * 编辑过(或人工关联未合成过)→ 409 needConfirm,客户端确认后带 confirm=true
 * 重发覆盖。未绑 compose 模型 400 人话;无素材 400;同专题进行中 409;PAT 拒。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import {
  checkComposeEligibility,
  enqueueTopicCompose,
  getTopicComposeState,
} from "@/lib/topics/compose-agent";
import { mapTopicError } from "@/lib/topics/http";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage topics";

const ID_RE = /^\d{1,10}$/;

const Body = z.object({ confirm: z.boolean().default(false) });

/** 资格预检(POST 入队前):id 形态 → 共享资格判定(素材非空/重合成 409) */
async function precheck(
  rawId: string,
  confirm: boolean,
): Promise<{ topicId: bigint } | NextResponse> {
  if (!ID_RE.test(rawId)) return apiEnvelope(400, "invalid id");
  const pre = await checkComposeEligibility(BigInt(rawId), confirm);
  if (!pre.ok) {
    return apiEnvelope(
      pre.needConfirm ? 409 : 400,
      pre.message,
      pre.needConfirm ? { needConfirm: true } : undefined,
    );
  }
  return { topicId: BigInt(rawId) };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const parsed = Body.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return apiEnvelope(400, "请求体须为 {confirm?: boolean}");
  try {
    const pre = await precheck(id, parsed.data.confirm);
    if ("topicId" in pre) {
      const { jobId } = await enqueueTopicCompose(pre.topicId);
      logger.info({ event: "topic.compose_requested", topicId: id, jobId });
      return apiEnvelope(202, "已进入合成队列,正在 AI 多步生成中…", { jobId });
    }
    return pre;
  } catch (e) {
    if (e instanceof AiAdminError) return apiEnvelope(aiErrorStatus(e.code), e.message);
    const mapped = mapTopicError(e);
    if (mapped) return mapped;
    throw e;
  }
}

/** 合成进度轮询(worker 管线状态;done 携带结果供前端免再查) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!ID_RE.test(id)) return apiEnvelope(400, "invalid id");
  const state = await getTopicComposeState(BigInt(id));
  return apiEnvelope(0, "ok", state);
}
