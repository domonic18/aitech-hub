/** 渠道调试(原型「调试」;2026-10-06 验收反馈问题3):拉最新 3 条 + 耗时,实时返回。 */
import { type NextRequest, NextResponse } from "next/server";

import { CHANNELS_PAT_DENY, requireSessionActor, toEnvelope } from "../../shared";
import { apiEnvelope } from "@/lib/http/response";
import { parseNumericId } from "@/lib/http/parse-id";
import { debugChannel } from "@/lib/telegram/channels-admin";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, CHANNELS_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const nid = parseNumericId(id);
  if (nid === null) return apiEnvelope(400, "invalid id");
  try {
    const r = await debugChannel(nid);
    return apiEnvelope(0, r.ok ? "ok" : "fail", r);
  } catch (e) {
    const mapped = toEnvelope(e);
    if (mapped) return mapped;
    throw e;
  }
}
