/**
 * PUT/DELETE /api/pricing/models/[id](M55 批A):牌价行改/删。PUT 全字段可选
 * (vendor+modelKey 组合唯一冲突 409;反常态守卫同 POST);DELETE 直接物理删
 * (策展数据无引用方)。仅会话(PAT 拒绝)。
 */
import { type NextRequest } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  deleteModelPricing,
  modelPricingUpdateSchema,
  updateModelPricing,
} from "@/lib/pricing/admin";

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
  const parsed = modelPricingUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  try {
    const row = await updateModelPricing(id, parsed.data);
    if (!row) return apiEnvelope(404, "牌价行不存在");
    return apiEnvelope(0, "updated", { row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "INVERTED_PRICING") {
      return apiEnvelope(400, "输入价高于输出价(反常态),如确认无误请带 confirmInverted 重提");
    }
    if (message.includes("uq_model_pricing_vendor_model")) {
      return apiEnvelope(409, `同厂商下模型已存在:${parsed.data.modelKey ?? ""}`);
    }
    return apiEnvelope(400, message);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionActor(_req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id === null) return apiEnvelope(400, "id 不合法");
  try {
    await deleteModelPricing(id);
    return apiEnvelope(0, "deleted");
  } catch {
    return apiEnvelope(404, "牌价行不存在");
  }
}
