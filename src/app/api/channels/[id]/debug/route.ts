/** 渠道调试(原型「调试」;2026-10-06 验收反馈问题3):拉最新 3 条 + 耗时,实时返回。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { ChannelAdminError, debugChannel } from "@/lib/telegram/channels-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage channels";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  try {
    const r = await debugChannel(Number(id));
    return apiEnvelope(0, r.ok ? "ok" : "fail", r);
  } catch (e) {
    if (e instanceof ChannelAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
}
