/**
 * PUT/DELETE /api/pricing/plans/[id](M55 批A):套餐行改/删。物理删(策展
 * 数据无引用方)。仅会话(PAT 拒绝)。
 */
import { type NextRequest } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  codingPlanUpdateSchema,
  deleteCodingPlan,
  updateCodingPlan,
  formatZodIssues,
} from "@/lib/pricing/admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage coding plans";

function parseId(raw: string): bigint | null {
  return /^\d{1,10}$/.test(raw) ? BigInt(raw) : null;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id === null) return apiEnvelope(400, "id 不合法");
  const parsed = codingPlanUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${formatZodIssues(parsed.error)}`);
  }
  try {
    const row = await updateCodingPlan(id, parsed.data);
    if (!row) return apiEnvelope(404, "套餐行不存在");
    return apiEnvelope(0, "updated", { row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("uq_coding_plan_vendor_plan")) {
      return apiEnvelope(409, `同厂商下套餐已存在:${parsed.data.planName ?? ""}`);
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
    await deleteCodingPlan(id);
    return apiEnvelope(0, "deleted");
  } catch {
    return apiEnvelope(404, "套餐行不存在");
  }
}
