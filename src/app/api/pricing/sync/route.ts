/**
 * POST /api/pricing/sync(M55 批B):手动触发 OpenRouter 牌价预填。入 pricing
 * 队列一次性 job(manual 前缀 jobId+时间戳,BullMQ 确定性 jobId 去重防静默丢),
 * 入队即返回;执行在 worker(weekly cron 同一 processor)。仅会话(PAT 拒绝)。
 * 结果可见:策展台「待审」行([openrouter 预填] note)与 job_run 台账。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { getQueue, PRICING_JOB_SYNC, QUEUE_PRICING } from "@/lib/queue";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not trigger pricing sync";

const bodySchema = z.object({ job: z.literal("sync-openrouter") });

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "unknown job");
  const queue = getQueue(QUEUE_PRICING);
  const job = await queue.add(
    PRICING_JOB_SYNC,
    {},
    { jobId: `${PRICING_JOB_SYNC}-manual-${Date.now()}` },
  );
  return apiEnvelope(0, "已加入处理队列,完成后见策展台待审行", { jobId: job.id });
}
