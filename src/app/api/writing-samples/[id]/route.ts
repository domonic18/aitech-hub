/**
 * 样例参照图库单条 API(M39 批③ §13.11):PATCH 重命名 / DELETE 删行。
 * 删行事务内置空 topic.sample_image_id 引用(soft ref,媒体不连带);
 * admin 会话 + PAT 拒 + Origin 关一体(requireSessionActor,mutation 同守)。
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { parseBigIntId } from "@/lib/http/parse-id";
import { deleteWritingSample, renameWritingSample } from "@/lib/topics/writing-samples";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage writing samples";

const NAME_SCHEMA = z.object({ name: z.string().trim().min(1, "名称必填").max(100) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = NAME_SCHEMA.safeParse(body);
  if (!parsed.success) return apiEnvelope(400, "name 必填且 ≤100 字");
  const sample = await renameWritingSample(bigId, parsed.data.name);
  if (!sample) return apiEnvelope(404, "样例参照图不存在");
  return apiEnvelope(0, "ok", sample);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const bigId = parseBigIntId(id);
  if (bigId === null) return apiEnvelope(400, "invalid id");
  const deleted = await deleteWritingSample(bigId);
  if (!deleted) return apiEnvelope(404, "样例参照图不存在");
  return apiEnvelope(0, "ok", { deleted: true });
}
