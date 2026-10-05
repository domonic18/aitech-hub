/**
 * GET /api/posts/cover-generate/[jobId]?token=<uuid>(M14 批⑥):编辑器轮询生图
 * 进度与候选。state 取 BullMQ 实况(job 被清视为 completed);候选按 token 查
 * (job 过期后历史候选仍可取)。会话鉴权。
 */
import { type NextRequest } from "next/server";

import { listCoverCandidates } from "@/lib/ai/cover-generate";
import { getQueue, QUEUE_COVER_GEN } from "@/lib/queue";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

/** BullMQ 状态 → 轮询面四态(waiting/active/delayed/prioritized/unknown 归等待或进行中) */
function mapState(st: string): "waiting" | "active" | "completed" | "failed" {
  if (st === "completed") return "completed";
  if (st === "failed") return "failed";
  if (st === "active") return "active";
  return "waiting";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const denied = await requireSessionActor(req, "PAT 不能读取生图进度");
  if (denied) return denied;

  const { jobId } = await params;
  if (!/^[a-z0-9-]{6,60}$/.test(jobId)) {
    return apiEnvelope(400, "jobId 格式不合法");
  }
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!/^[0-9a-f-]{8,64}$/.test(token)) {
    return apiEnvelope(400, "token 缺失或不合法");
  }

  const job = await getQueue(QUEUE_COVER_GEN).getJob(jobId);
  const state = job ? mapState(await job.getState()) : "completed";
  const error = job?.failedReason ? job.failedReason.slice(0, 300) : null;
  const candidates = await listCoverCandidates(token);
  return apiEnvelope(0, "ok", { state, error, candidates });
}
