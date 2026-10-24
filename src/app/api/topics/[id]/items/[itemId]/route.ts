/**
 * 专题素材单条 API(M26 批③治理台,方案 §8 items 路由的条目半边):
 * PATCH 批注/排序(挂载记录 id,非素材 id);DELETE 卸载。
 */
import { type NextRequest, NextResponse } from "next/server";

import { parseBigIntId } from "@/lib/http/parse-id";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { toItemDto } from "@/lib/topics/dto";
import { mapTopicError } from "@/lib/topics/http";
import { unmountItem, updateItem } from "@/lib/topics/materials";
import { itemUpdateSchema } from "@/lib/topics/schemas";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage topics";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { itemId } = await params;
  const itemKey = parseBigIntId(itemId);
  if (itemKey === null) return apiEnvelope(400, "invalid id");
  const parsed = itemUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "批注最长 500 字符,排序为非负整数");
  try {
    const item = await updateItem(itemKey, parsed.data);
    return apiEnvelope(0, "ok", toItemDto(item));
  } catch (e) {
    const mapped = mapTopicError(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id, itemId } = await params;
  const topicKey = parseBigIntId(id);
  const itemKey = parseBigIntId(itemId);
  if (topicKey === null || itemKey === null) return apiEnvelope(400, "invalid id");
  try {
    await unmountItem(topicKey, itemKey);
    return apiEnvelope(0, "unmounted");
  } catch (e) {
    const mapped = mapTopicError(e);
    if (mapped) return mapped;
    throw e;
  }
}
