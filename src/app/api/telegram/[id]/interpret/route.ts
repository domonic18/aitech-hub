/** 手动触发视频解读(M9 批③):存量补读与失败重试同入口,入队即返回,结果看治理台解读列。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { TelegramInterpretError, triggerTelegramInterpret } from "@/lib/telegram/telegram-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not govern telegram";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiEnvelope(400, "invalid id");
  try {
    const r = await triggerTelegramInterpret(BigInt(id));
    return apiEnvelope(0, "enqueued", r);
  } catch (e) {
    if (e instanceof TelegramInterpretError) {
      return apiEnvelope(
        e.code === "not_found" ? 404 : e.code === "no_link" ? 409 : 400,
        e.message,
      );
    }
    throw e;
  }
}
