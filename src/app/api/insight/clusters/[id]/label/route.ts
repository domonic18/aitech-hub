/** 簇手动补标(M60 批C):簇详情「立即打标」后端——入 insight 队列 label job
 * (data.clusterId 走单簇路径,与 30 分钟小批同处理器)。入队前做零 LLM 前置
 * 检查(模型绑定/当日配额/成员数),把「为什么打不了」当场告诉用户,而不是
 * 排进队列后无声失败。仅会话通道(PAT 不得触发洞察加工,同 trigger 口径)。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { parseBigIntId } from "@/lib/http/parse-id";
import { apiEnvelope } from "@/lib/http/response";
import { LABEL_MIN_MEMBERS } from "@/lib/insight/constants";
import { labelReadiness, type ClusterLabelOutcome } from "@/lib/insight/label";
import { getQueue, INSIGHT_JOB_LABEL, QUEUE_INSIGHT } from "@/lib/queue";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not trigger insight labeling";

/** 阻断原因 → HTTP 状态 + 人话(payload 与 message 同源,前端直接展示) */
const BLOCKED: Record<
  Extract<ClusterLabelOutcome, "unbound" | "quota_exhausted" | "too_small" | "not_found">,
  { code: 404 | 409 | 429; message: string }
> = {
  unbound: { code: 409, message: "未绑定「洞察归纳」模型——去 AI 配置绑定后再试" },
  quota_exhausted: {
    code: 429,
    message: "今日洞察打标配额已用尽——明日自动恢复,或在 AI 配置调高日上限",
  },
  too_small: {
    code: 409,
    message: `簇成员不足打标门槛(需 ≥${LABEL_MIN_MEMBERS} 条信号),继续累计后自动进队`,
  },
  not_found: { code: 404, message: "簇不存在或已无成员信号" },
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "簇 id 不合法");

  const ready = await labelReadiness(bigId);
  if (!ready.ok) {
    const { code, message } = BLOCKED[ready.outcome];
    return apiEnvelope(code, message, { outcome: ready.outcome });
  }

  const job = await getQueue(QUEUE_INSIGHT).add(
    INSIGHT_JOB_LABEL,
    { clusterId: bigId.toString() },
    { jobId: `${INSIGHT_JOB_LABEL}-manual-${bigId.toString()}-${Date.now()}` },
  );
  return apiEnvelope(0, "enqueued", { jobId: String(job.id), clusterId: bigId.toString() });
}
