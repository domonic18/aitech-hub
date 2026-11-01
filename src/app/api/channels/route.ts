/**
 * 渠道台账 API(M7 批④):列表(脱敏出参)与新建。
 * 渠道持有采集凭证,仅会话通道(PAT 不得管理基础设施配置,同 users 口径)。
 */
import { type NextRequest, NextResponse } from "next/server";

import { CHANNELS_PAT_DENY, requireSessionActor, toEnvelope } from "./shared";
import { apiEnvelope } from "@/lib/http/response";
import {
  ChannelInputSchema,
  createChannel,
  listChannelsAdmin,
} from "@/lib/telegram/channels-admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, CHANNELS_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const items = await listChannelsAdmin();
  return apiEnvelope(0, "ok", { items });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, CHANNELS_PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = ChannelInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "渠道字段不合法(名称/类型/端点/频率)");
  try {
    const r = await createChannel(parsed.data);
    return apiEnvelope(0, "created", r);
  } catch (e) {
    const mapped = toEnvelope(e);
    if (mapped) return mapped;
    throw e;
  }
}
