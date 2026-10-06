/**
 * GET /api/distribute/wechat/batch/[jobId]?token=<uuid>(M17 批④):批量同步轮询。
 * state 取 BullMQ 实况;进度读 job.updateProgress 快照(processed/total/failedIds),
 * 同 seo-batch 口径。token 须与 job 数据匹配(防串查);会话鉴权。
 */
import { type NextRequest } from "next/server";

import { type WechatBatchProgress } from "@/lib/distribute/wechat-sync-run";
import { getQueue, QUEUE_DISTRIBUTE } from "@/lib/queue";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

/** BullMQ 状态 → 轮询面四态(waiting/delayed/prioritized/unknown 归等待) */
function mapState(st: string): "waiting" | "active" | "completed" | "failed" {
  if (st === "completed") return "completed";
  if (st === "failed") return "failed";
  if (st === "active") return "active";
  return "waiting";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const actor = await requireSessionActor(req, "PAT 不能读取批量同步进度");
  if (actor.kind === "reject") return actor.response;

  const { jobId } = await params;
  if (!/^[a-z0-9-]{6,60}$/.test(jobId)) {
    return apiEnvelope(400, "jobId 格式不合法");
  }
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{8,64}$/.test(token)) {
    return apiEnvelope(400, "token 缺失或不合法");
  }

  const job = await getQueue(QUEUE_DISTRIBUTE).getJob(jobId);
  if (!job || (job.data as { token?: string } | null)?.token !== token) {
    return apiEnvelope(404, "任务不存在或已清理");
  }
  const state = mapState(await job.getState());
  const error = job.failedReason ? job.failedReason.slice(0, 300) : null;
  const p = (job.progress ?? {}) as Partial<WechatBatchProgress>;
  const total = Number(p.total ?? 0) || ((job.data as { ids?: string[] } | null)?.ids?.length ?? 0);
  return apiEnvelope(0, "ok", {
    state,
    error,
    processed: Number(p.processed ?? 0),
    total,
    failedIds: Array.isArray(p.failedIds) ? p.failedIds : [],
  });
}
