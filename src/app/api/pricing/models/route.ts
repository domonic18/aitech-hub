/**
 * GET/POST /api/pricing/models(M55 批A):模型牌价策展——GET 全量(status/
 * region 过滤,管理台直读);POST 新建(爬虫/手工数据统一入口,缺省落 pending;
 * 输入价>输出价需 confirmInverted 显式确认)。仅会话(PAT 不得操纵牌价)。
 */
import { type NextRequest } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  createModelPricing,
  listModelPricing,
  modelPricingCreateSchema,
  type PricingStatus,
  formatZodIssues,
} from "@/lib/pricing/admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage model pricing";

export async function GET(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const status = req.nextUrl.searchParams.get("status");
  const region = req.nextUrl.searchParams.get("region");
  const rows = await listModelPricing({
    status: status !== null && status !== "" ? (status as PricingStatus) : undefined,
    region: region !== null && region !== "" ? region : undefined,
  });
  return apiEnvelope(0, "ok", { rows });
}

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = modelPricingCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${formatZodIssues(parsed.error)}`);
  }
  try {
    const row = await createModelPricing(parsed.data);
    return apiEnvelope(0, "created", { row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "INVERTED_PRICING") {
      return apiEnvelope(400, "输入价高于输出价(反常态),如确认无误请带 confirmInverted 重提");
    }
    if (message.includes("uq_model_pricing_vendor_model")) {
      return apiEnvelope(409, `同厂商下模型已存在:${parsed.data.modelKey}`);
    }
    return apiEnvelope(400, message);
  }
}
