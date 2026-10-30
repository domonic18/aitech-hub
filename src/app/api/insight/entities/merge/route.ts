/** 洞察实体人工归并(M60):把 `fromKey` 的别名/事件/子实体并入 `toKey`。
 * 仅会话通道(PAT 不得改实体层);key 可传规范键或任一别名。 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { isCanonicalEntityKey } from "@/lib/insight/entities-admin";
import { mergeEntities } from "@/lib/insight/entities/resolve";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not merge insight entities";

const mergeSchema = z.object({
  fromKey: z.string().min(1).max(120).refine(isCanonicalEntityKey, "fromKey 形态不合法"),
  toKey: z.string().min(1).max(120).refine(isCanonicalEntityKey, "toKey 形态不合法"),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;

  const parsed = mergeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, parsed.error.issues[0]?.message ?? "参数不合法");
  }
  const { fromKey, toKey } = parsed.data;
  if (fromKey === toKey) return apiEnvelope(400, "不能并入自身");

  const outcome = await mergeEntities(fromKey, toKey);
  if (outcome === "not_found") return apiEnvelope(404, "实体不存在或已是同一实体");
  if (outcome === "cycle") return apiEnvelope(400, "目标实体是源实体的下级,不能成环归并");
  return apiEnvelope(0, "merged", outcome);
}
