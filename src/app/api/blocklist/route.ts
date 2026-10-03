/** 屏蔽词 API(M7 批④):列表 + 新增;仅会话通道。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import {
  BlocklistAddSchema,
  BlocklistAdminError,
  addBlocklistWord,
  listBlocklist,
} from "@/lib/telegram/blocklist-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not govern blocklist";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  return apiEnvelope(0, "ok", { items: await listBlocklist() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const parsed = BlocklistAddSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "word(1-100 字)与 scope(title/summary/all)必填");
  try {
    const r = await addBlocklistWord(parsed.data);
    return apiEnvelope(0, "added", r);
  } catch (e) {
    if (e instanceof BlocklistAdminError) return apiEnvelope(409, e.message);
    throw e;
  }
}
