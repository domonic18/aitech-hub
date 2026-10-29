/** 渠道启停(M7 批④):行内一键切换;停用后调度器不再派发。 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { CHANNELS_PAT_DENY, requireSessionActor, toEnvelope } from "../../shared";
import { apiEnvelope } from "@/lib/http/response";
import { parseNumericId } from "@/lib/http/parse-id";
import { setChannelEnabled } from "@/lib/telegram/channels-admin";

export const dynamic = "force-dynamic";

const Body = z.object({ enabled: z.boolean() });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, CHANNELS_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  const nid = parseNumericId(id);
  if (nid === null) return apiEnvelope(400, "invalid id");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "enabled 须为布尔");
  try {
    await setChannelEnabled(nid, parsed.data.enabled);
    return apiEnvelope(0, parsed.data.enabled ? "enabled" : "disabled");
  } catch (e) {
    const mapped = toEnvelope(e);
    if (mapped) return mapped;
    throw e;
  }
}
