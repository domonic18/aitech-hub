/**
 * GET/POST /api/insight/taxonomy(M54 批A):领域词表读/建。
 * GET=全量清单(含停用行,管理台直读);POST=新建(key/label/kind/parent)。
 * 会话鉴权(PAT 不得操纵词表);错误人话 apiEnvelope。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { createTaxonomy, listTaxonomy, validateParent } from "@/lib/insight/taxonomy";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage insight taxonomy";

export async function GET(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const rows = await listTaxonomy();
  return apiEnvelope(0, "ok", { rows });
}

const createSchema = z.object({
  kind: z.enum(["domain", "subdomain"]),
  key: z.string().trim().min(2).max(29),
  label: z.string().trim().min(1).max(30),
  parent: z.string().trim().max(30).optional().nullable(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  try {
    const parentErr = await validateParent(parsed.data.kind, parsed.data.parent ?? null);
    if (parentErr) return apiEnvelope(400, parentErr);
    const row = await createTaxonomy(parsed.data);
    return apiEnvelope(0, "created", { row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("insight_taxonomy_key_key")) {
      return apiEnvelope(409, `key 已存在:${parsed.data.key}`);
    }
    return apiEnvelope(400, message);
  }
}
