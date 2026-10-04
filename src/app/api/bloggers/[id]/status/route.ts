/** 博主启停(M8 批③):行内一键切换;停用后调度器不再派发该博主。 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { BloggerAdminError, setBloggerEnabled } from "@/lib/telegram/bloggers-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage bloggers";
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
    await setBloggerEnabled(Number(id), parsed.data.enabled);
    return apiEnvelope(0, parsed.data.enabled ? "enabled" : "disabled");
  } catch (e) {
    if (e instanceof BloggerAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
}
