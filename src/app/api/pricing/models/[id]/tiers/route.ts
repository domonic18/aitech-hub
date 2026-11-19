/**
 * PUT /api/pricing/models/[id]/tiers(M74 批C2):牌价行的**档位订正**。
 *
 * 档位(阶梯价 / 缓存价 / 峰谷价)是采集解析出来的,页面改版或口径解析偏差时
 * 需要人工订正——此前只能直改库。整行档位替换(与采集侧 replaceTiers 同口径:
 * 档位集按源整批刷新,不增量合并)。
 * 仅会话(PAT 拒绝,同单行口径)。
 */
import { type NextRequest } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { formatZodIssues, modelPricingTiersUpdateSchema } from "@/lib/pricing/admin-schema";
import { updateModelPricingTiers } from "@/lib/pricing/admin-model";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage model pricing";

function parseId(raw: string): bigint | null {
  return /^\d{1,10}$/.test(raw) ? BigInt(raw) : null;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id === null) return apiEnvelope(400, "id 不合法");
  const parsed = modelPricingTiersUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${formatZodIssues(parsed.error)}`);
  }
  try {
    const count = await updateModelPricingTiers(id, parsed.data.tiers);
    if (count === null) return apiEnvelope(404, "牌价行不存在");
    return apiEnvelope(0, "updated", { count });
  } catch (e) {
    return apiEnvelope(400, e instanceof Error ? e.message : String(e));
  }
}
