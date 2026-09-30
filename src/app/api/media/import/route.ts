/**
 * 一键发文 · 外链图批量转存(arch/05-services §5 media 行):
 * POST /api/media/import {urls} → enqueue media.transfer,返回 { jobId, total };
 * GET  /api/media/import?job=<id> → 轮询 { state, progress, result }(url → 站内路径;
 * 失败项为 null,导入端保留原链)。会话零落库:BullMQ job returnvalue 即映射表。
 */
import { type NextRequest } from "next/server";

import { requireAdminRequest } from "@/lib/auth/guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { mediaImportSchema } from "@/lib/media/media-schema";
import { getQueue, QUEUE_MEDIA_TRANSFER } from "@/lib/queue";

import { requireAdminForMutation } from "../shared";

export const dynamic = "force-dynamic";

/** 单批 jobId(随机串即可:幂等由 sha1 入库去重兜底,批次不要求幂等) */
function newBatchId(): string {
  return `mt:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: NextRequest) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = mediaImportSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }

  const jobId = newBatchId();
  await getQueue(QUEUE_MEDIA_TRANSFER).add(
    "transfer",
    { urls: parsed.data.urls },
    { jobId, attempts: 1, removeOnComplete: 500, removeOnFail: 500 },
  );
  logger.info({ event: "media.import", jobId, total: parsed.data.urls.length });
  return apiEnvelope(0, "accepted", { jobId, total: parsed.data.urls.length }, 202);
}

/** GET 轮询:非 mutation,只走会话完整校验(无 Origin 关) */
export async function GET(req: NextRequest) {
  const claims = await requireAdminRequest(req);
  if (!claims) return apiEnvelope(401, "unauthorized");

  const jobId = new URL(req.url).searchParams.get("job");
  if (!jobId) return apiEnvelope(400, "缺少 job 参数");
  const job = await getQueue(QUEUE_MEDIA_TRANSFER).getJob(jobId);
  if (!job) return apiEnvelope(404, "任务不存在或已清理");
  const state = await job.getState();
  const progress = typeof job.progress === "number" ? job.progress : 0;
  const result = (job.returnvalue ?? null) as {
    mapping: Record<string, string | null>;
    ok: number;
    failed: number;
  } | null;
  return apiEnvelope(0, "ok", { state, progress, result });
}
