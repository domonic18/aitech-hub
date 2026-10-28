/**
 * PUT/DELETE /api/insight/taxonomy/[id](M54 批A):词表行改/删。
 * PUT=label/排序/启停/子域 parent(key 禁改);DELETE=在用守卫(信号/簇引用
 * 中 409,建议停用替代)。会话鉴权(PAT 不得操纵词表)。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { deleteTaxonomy, updateTaxonomy } from "@/lib/insight/taxonomy";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage insight taxonomy";

const updateSchema = z.object({
  label: z.string().trim().min(1).max(30).optional(),
  parent: z.string().trim().max(30).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

function parseId(raw: string): number | null {
  return /^\d{1,10}$/.test(raw) ? Number(raw) : null;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id === null) return apiEnvelope(400, "id 不合法");

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  try {
    const row = await updateTaxonomy(id, parsed.data);
    if (!row) return apiEnvelope(404, "词表行不存在");
    return apiEnvelope(0, "updated", { row });
  } catch (e) {
    return apiEnvelope(400, e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id === null) return apiEnvelope(400, "id 不合法");
  try {
    await deleteTaxonomy(id);
    return apiEnvelope(0, "deleted");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("不存在")) return apiEnvelope(404, message);
    return apiEnvelope(409, message);
  }
}
