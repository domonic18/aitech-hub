/**
 * GET /api/posts/seo-suggest-batch/[jobId]?token=<uuid>(M16 问题8):文章管理
 * 轮询批量 SEO 补全进度。state 取 BullMQ 实况(job 被清视为 completed);
 * 进度读 job.updateProgress 快照(processed/total/skipped/failedIds)。
 * token 须与 job 数据匹配(防串查);会话鉴权。
 */
import { type NextRequest } from "next/server";

import { type SeoBatchProgress } from "@/lib/ai/seo-batch";
import { getQueue, QUEUE_SEO_BATCH } from "@/lib/queue";
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
  const actor = await requireSessionActor(req, "PAT 不能读取批量 SEO 进度");
  if (actor.kind === "reject") return actor.response;

  const { jobId } = await params;
  if (!/^[a-z0-9-]{6,60}$/.test(jobId)) {
    return apiEnvelope(400, "jobId 格式不合法");
  }
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{8,64}$/.test(token)) {
    return apiEnvelope(400, "token 缺失或不合法");
  }

  const job = await getQueue(QUEUE_SEO_BATCH).getJob(jobId);
  if (!job || (job.data as { token?: string } | null)?.token !== token) {
    return apiEnvelope(404, "任务不存在或已清理");
  }
  const state = mapState(await job.getState());
  const error = job.failedReason ? job.failedReason.slice(0, 300) : null;
  const p = (job.progress ?? {}) as Partial<SeoBatchProgress>;
  const total = Number(p.total ?? 0) || ((job.data as { ids?: string[] } | null)?.ids?.length ?? 0);
  return apiEnvelope(0, "ok", {
    state,
    error,
    processed: Number(p.processed ?? 0),
    total,
    skipped: Number(p.skipped ?? 0),
    failedIds: Array.isArray(p.failedIds) ? p.failedIds : [],
  });
}
