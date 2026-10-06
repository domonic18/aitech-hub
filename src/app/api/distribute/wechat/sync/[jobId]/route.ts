/**
 * GET /api/distribute/wechat/sync/[jobId]?token=<uuid>(M17 批④):单篇同步轮询。
 * state 取 BullMQ 实况(job 被清视为 404);completed 读 returnvalue
 * (ok/mediaId/reason,即 syncOnePost 结果),failed 读 failedReason 人话。
 * token 须与 job 数据匹配(防串查);会话鉴权。
 */
import { type NextRequest } from "next/server";

import { type WechatSyncResult } from "@/lib/distribute/wechat-sync";
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
  const actor = await requireSessionActor(req, "PAT 不能读取同步进度");
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
  if (state === "completed") {
    const rv = job.returnvalue as Partial<WechatSyncResult> | undefined;
    return apiEnvelope(0, "ok", {
      state,
      ok: rv?.ok ?? null,
      mediaId: rv?.mediaId ?? null,
      reason: rv?.reason ?? null,
    });
  }
  if (state === "failed") {
    return apiEnvelope(0, "ok", {
      state,
      ok: false,
      mediaId: null,
      reason: (job.failedReason ?? "").slice(0, 300),
    });
  }
  return apiEnvelope(0, "ok", { state, ok: null, mediaId: null, reason: null });
}
