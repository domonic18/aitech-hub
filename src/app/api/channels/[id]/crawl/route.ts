/** 手动触发采集(M7 批④):入队即返回,采集结果看台账(spider 总览看队列)。 */
import { type NextRequest, NextResponse } from "next/server";

import { CHANNELS_PAT_DENY, requireSessionActor, toEnvelope } from "../../shared";
import { apiEnvelope } from "@/lib/http/response";
import { parseNumericId } from "@/lib/http/parse-id";
import { triggerChannelCrawl } from "@/lib/telegram/channels-admin";

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
    const r = await triggerChannelCrawl(nid);
    return apiEnvelope(0, "enqueued", r);
  } catch (e) {
    const mapped = toEnvelope(e);
    if (mapped) return mapped;
    throw e;
  }
}
