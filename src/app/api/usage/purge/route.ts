/**
 * POST /api/usage/purge(M14 批⑦,看板「清理明细」):手动清 90 天前 ai_usage_log,
 * 与 worker 日清同口径(usage-log.ts AI_USAGE_RETENTION_DAYS)。会话鉴权
 * (PAT 不代理管理面交互,同 seo-suggest);返回删除行数。
 */
import { type NextRequest } from "next/server";

import { AI_USAGE_RETENTION_DAYS, purgeAiUsageOlderThan } from "@/lib/ai/usage-log";
import { apiEnvelope } from "@/lib/http/response";
import { requireSessionActor } from "@/lib/http/session-guard";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能触发用量明细清理");
  if (actor.kind === "reject") return actor.response;
  const removed = await purgeAiUsageOlderThan(AI_USAGE_RETENTION_DAYS);
  logger.info({ event: "ai_usage.manual_purge", removed });
  return apiEnvelope(0, "ok", { removed });
}
