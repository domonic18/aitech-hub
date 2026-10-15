/**
 * 电报条目批量状态操作(M31 验收反馈):hide→hidden / archive→archived /
 * delete→deleted(软删终态,原不经 UI 触达,批量口显式开放并确认)。逐条
 * 镜像 updateTelegramItem(不存在跳过列原因);守卫同单条 requireSessionActor
 * (PAT 拒)。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { batchIdsSchema, dedupeIds, type BatchOutcome } from "@/lib/http/batch";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { TelegramAdminError, updateTelegramItem } from "@/lib/telegram/telegram-admin";
import {
  TELEGRAM_STATUS_ARCHIVED,
  TELEGRAM_STATUS_DELETED,
  TELEGRAM_STATUS_HIDDEN,
} from "@/lib/telegram/constants";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not govern telegram";

const Body = z.object({
  ids: batchIdsSchema(),
  action: z.enum(["hide", "archive", "delete"]),
});

const ACTION_STATUS = {
  hide: TELEGRAM_STATUS_HIDDEN,
  archive: TELEGRAM_STATUS_ARCHIVED,
  delete: TELEGRAM_STATUS_DELETED,
} as const;

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const status = ACTION_STATUS[parsed.data.action];
  const ids = dedupeIds(parsed.data.ids);
  const out: BatchOutcome = { updated: 0, skipped: [] };
  for (const id of ids) {
    try {
      await updateTelegramItem(BigInt(id), { status });
      out.updated += 1;
    } catch (e) {
      if (!(e instanceof TelegramAdminError)) throw e;
      out.skipped.push({ id, reason: e.code === "not_found" ? "不存在" : e.code });
    }
  }
  logger.info({
    event: "telegram.batch_status",
    operatorId: actor.sub,
    action: parsed.data.action,
    total: ids.length,
    updated: out.updated,
  });
  return apiEnvelope(0, "ok", out);
}
