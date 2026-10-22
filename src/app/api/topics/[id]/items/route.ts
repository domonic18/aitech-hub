/**
 * 专题素材挂载 API(M26 批③治理台,方案 §8):POST 挂载电报条目/文章到专题
 * (telegram 须解读完成;唯一约束去重 409)。列表/卸载/批注走 [itemId] 子路由。
 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { toItemDto } from "@/lib/topics/dto";
import { mapTopicError } from "@/lib/topics/http";
import { mountItem } from "@/lib/topics/materials";
import { itemMountSchema } from "@/lib/topics/schemas";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage topics";

const ID_RE = /^\d{1,10}$/;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!ID_RE.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = itemMountSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "挂载参数不合法(itemType 枚举 + itemId 纯数字)");
  try {
    const item = await mountItem(BigInt(id), parsed.data);
    return apiEnvelope(0, "mounted", toItemDto(item));
  } catch (e) {
    const mapped = mapTopicError(e);
    if (mapped) return mapped;
    throw e;
  }
}
