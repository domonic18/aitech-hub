/** 热榜源启停(M34 批③ 验收反馈:纳入采集计划管理):行内开关一键切换,
 * 停用后 fetch 轮整源跳过;存量信号照常展示(读侧白名单不动)。 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { HotSourceError, setHotSourceEnabled } from "@/lib/insight/hot-source";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage hot sources";
const Body = z.object({ enabled: z.boolean() });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ source: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { source } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "enabled 须为布尔");
  try {
    await setHotSourceEnabled(source, parsed.data.enabled);
    return apiEnvelope(0, parsed.data.enabled ? "enabled" : "disabled");
  } catch (e) {
    if (e instanceof HotSourceError) return apiEnvelope(404, e.message);
    throw e;
  }
}
