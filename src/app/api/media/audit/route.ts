/**
 * POST /api/media/audit — 手动触发体检(media.audit;每日定时之外的后台按钮):
 * enqueue 后立即返回 jobId,扫描在 worker 执行(请求内禁秒级任务,arch/00 §7)。
 */
import { type NextRequest } from "next/server";

import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { getQueue, QUEUE_MEDIA_AUDIT } from "@/lib/queue";

import { requireAdminForMutation } from "../shared";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAdminForMutation(req);
  if (denied) return denied;

  const jobId = `audit:${Date.now().toString(36)}`;
  await getQueue(QUEUE_MEDIA_AUDIT).add("audit", {}, { jobId, removeOnComplete: 50 });
  logger.info({ event: "media.audit.trigger", jobId });
  return apiEnvelope(0, "accepted", { jobId }, 202);
}
