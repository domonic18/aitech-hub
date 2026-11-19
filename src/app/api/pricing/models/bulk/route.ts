/**
 * POST /api/pricing/models/bulk(M74 批C):模型牌价**批量终审**。
 *
 * 为什么要有:采集落 pending,人工逐行审太慢;批量「通过」才能让新采到的行上架
 * (前台只显示 enabled 行)。仅会话(PAT 不得操纵牌价,同单行口径)。
 */
import { type NextRequest } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { formatZodIssues, PRICING_STATUSES } from "@/lib/pricing/admin-schema";
import { bulkReviewModelPricing } from "@/lib/pricing/admin-model";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage model pricing";

const bodySchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(500),
  status: z.enum(PRICING_STATUSES),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${formatZodIssues(parsed.error)}`);
  }
  const count = await bulkReviewModelPricing(parsed.data.ids, parsed.data.status);
  return apiEnvelope(0, "ok", { count });
}
