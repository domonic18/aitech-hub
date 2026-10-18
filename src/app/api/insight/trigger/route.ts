/**
 * 洞察任务手动触发 API(验收二批①):POST { job: "hotboard" | "daily" }。
 * 入 insight 队列一次性 job(jobId 带 manual 前缀,与 cron 调度 job 不冲突),
 * 入队即返回——执行在 worker;热榜结果看「源管理·热榜源」榜面,日批打标/快照
 * 结果看「洞察」页。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { triggerInsight } from "@/lib/insight/trigger";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not trigger insight jobs";

const Body = z.object({ job: z.enum(["hotboard", "daily"]) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "job 不合法(hotboard | daily)");
  await triggerInsight(parsed.data.job);
  return apiEnvelope(0, "enqueued", { job: parsed.data.job });
}
