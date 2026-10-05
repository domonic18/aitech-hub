/** 手动触发/重新生成文字摘要(M12 批⑥):治理台行按钮入口,入队即返回,结果看治理台解读列。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { TELEGRAM_ID_RE } from "@/lib/telegram/constants";
import { TelegramSummarizeError, triggerTelegramSummarize } from "@/lib/telegram/telegram-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not govern telegram";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!TELEGRAM_ID_RE.test(id)) return apiEnvelope(400, "invalid id");
  try {
    const r = await triggerTelegramSummarize(BigInt(id));
    return apiEnvelope(0, "enqueued", r);
  } catch (e) {
    if (e instanceof TelegramSummarizeError) {
      return apiEnvelope(e.code === "not_found" ? 404 : 400, e.message);
    }
    throw e;
  }
}
