/** 渠道编辑/删除(编辑 M7 批④;删除 2026-10-24 验收):编辑为全量表单更新,
 *  token 写侧规则见 service(空串清除/缺省沿用);删除级联清除已采集条目,
 *  视频平台行(service in_use 拒绝)→ 409。 */
import { type NextRequest, NextResponse } from "next/server";

import { CHANNELS_PAT_DENY, requireSessionActor, toEnvelope } from "../shared";
import { apiEnvelope } from "@/lib/http/response";
import { parseNumericId } from "@/lib/http/parse-id";
import { ChannelInputSchema, deleteChannel, updateChannel } from "@/lib/telegram/channels-admin";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, CHANNELS_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const nid = parseNumericId(id);
  if (nid === null) return apiEnvelope(400, "invalid id");
  const parsed = ChannelInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "渠道字段不合法(名称/类型/端点/频率)");
  try {
    const r = await updateChannel(nid, parsed.data);
    return apiEnvelope(0, "updated", r);
  } catch (e) {
    const mapped = toEnvelope(e);
    if (mapped) return mapped;
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, CHANNELS_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const nid = parseNumericId(id);
  if (nid === null) return apiEnvelope(400, "invalid id");
  try {
    await deleteChannel(nid);
    return apiEnvelope(0, "deleted");
  } catch (e) {
    const mapped = toEnvelope(e);
    if (mapped) return mapped;
    throw e;
  }
}
