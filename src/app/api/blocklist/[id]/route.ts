/** 屏蔽词启停/删除(M7 批④);仅会话通道。 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  BlocklistAdminError,
  deleteBlocklistWord,
  setBlocklistEnabled,
} from "@/lib/telegram/blocklist-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not govern blocklist";
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
    await setBlocklistEnabled(Number(id), parsed.data.enabled);
    return apiEnvelope(0, parsed.data.enabled ? "enabled" : "disabled");
  } catch (e) {
    if (e instanceof BlocklistAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  try {
    await deleteBlocklistWord(Number(id));
    return apiEnvelope(0, "removed");
  } catch (e) {
    if (e instanceof BlocklistAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
}
