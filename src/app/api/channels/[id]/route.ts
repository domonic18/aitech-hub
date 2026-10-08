/** 渠道编辑(M7 批④):全量表单更新;token 写侧规则见 service(空串清除/缺省沿用)。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  ChannelAdminError,
  ChannelInputSchema,
  updateChannel,
} from "@/lib/telegram/channels-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage channels";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = ChannelInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "渠道字段不合法(名称/类型/端点/频率)");
  try {
    const r = await updateChannel(Number(id), parsed.data);
    return apiEnvelope(0, "updated", r);
  } catch (e) {
    if (e instanceof ChannelAdminError) {
      return apiEnvelope(
        e.code === "not_found" ? 404 : e.code === "name_taken" ? 409 : 400,
        e.message,
      );
    }
    throw e;
  }
}
