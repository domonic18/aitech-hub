/** 渠道启停(M7 批④):行内一键切换;停用后调度器不再派发。 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { ChannelAdminError, setChannelEnabled } from "@/lib/telegram/channels-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage channels";
const Body = z.object({ enabled: z.boolean() });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "enabled 须为布尔");
  try {
    await setChannelEnabled(Number(id), parsed.data.enabled);
    return apiEnvelope(0, parsed.data.enabled ? "enabled" : "disabled");
  } catch (e) {
    if (e instanceof ChannelAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
}
