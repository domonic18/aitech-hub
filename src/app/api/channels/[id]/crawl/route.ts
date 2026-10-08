/** 手动触发采集(M7 批④):入队即返回,采集结果看台账(spider 总览看队列)。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { ChannelAdminError, triggerChannelCrawl } from "@/lib/telegram/channels-admin";

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
    const r = await triggerChannelCrawl(Number(id));
    return apiEnvelope(0, "enqueued", r);
  } catch (e) {
    if (e instanceof ChannelAdminError) {
      return apiEnvelope(e.code === "not_found" ? 404 : 409, e.message);
    }
    throw e;
  }
}
