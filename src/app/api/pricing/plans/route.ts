/**
 * GET/POST /api/pricing/plans(M55 批A):Coding Plan 套餐策展——GET 全量
 * (status 过滤);POST 新建(额度口径按官方原文,不归一)。仅会话(PAT 拒绝)。
 */
import { type NextRequest } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  codingPlanCreateSchema,
  createCodingPlan,
  listCodingPlans,
  type PricingStatus,
} from "@/lib/pricing/admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage coding plans";

export async function GET(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const status = req.nextUrl.searchParams.get("status");
  const rows = await listCodingPlans({
    status: status !== null && status !== "" ? (status as PricingStatus) : undefined,
  });
  return apiEnvelope(0, "ok", { rows });
}

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = codingPlanCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  try {
    const row = await createCodingPlan(parsed.data);
    return apiEnvelope(0, "created", { row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("uq_coding_plan_vendor_plan")) {
      return apiEnvelope(409, `同厂商下套餐已存在:${parsed.data.planName}`);
    }
    return apiEnvelope(400, message);
  }
}
