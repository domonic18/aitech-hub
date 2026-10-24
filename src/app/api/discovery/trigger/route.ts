/**
 * 发现任务手动触发 API(M25 批③治理台):POST { job: "hotwords" | "bili" }。
 * 入 discovery 队列一次性 job(jobId 带 manual 前缀,与 cron 调度 job 不冲突),
 * 入队即返回——执行与风控节奏在 worker,结果看词库/候选两表与任务日志。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { DISCOVERY_TRIGGER_JOBS, triggerDiscovery } from "@/lib/discovery/admin";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not trigger discovery jobs";

const Body = z.object({ job: z.enum(DISCOVERY_TRIGGER_JOBS) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "job 不合法(hotwords | bili)");
  await triggerDiscovery(parsed.data.job);
  return apiEnvelope(0, "enqueued", { job: parsed.data.job });
}
