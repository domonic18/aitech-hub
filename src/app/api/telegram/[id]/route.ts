/** 电报条目治理(M7 批④):标题摘要修正 + 状态迁移;仅会话通道。 */
import { type NextRequest, NextResponse } from "next/server";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { TELEGRAM_ID_RE } from "@/lib/telegram/constants";
import {
  TelegramAdminError,
  TelegramUpdateSchema,
  updateTelegramItem,
} from "@/lib/telegram/telegram-admin";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not govern telegram";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;
  const { id } = await params;
  if (!TELEGRAM_ID_RE.test(id)) return apiEnvelope(400, "invalid id");
  const parsed = TelegramUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiEnvelope(400, "字段不合法(title≤500/summary≤1000/status 三态)");
  try {
    const r = await updateTelegramItem(BigInt(id), parsed.data);
    return apiEnvelope(0, "updated", r);
  } catch (e) {
    if (e instanceof TelegramAdminError) return apiEnvelope(404, e.message);
    throw e;
  }
}
