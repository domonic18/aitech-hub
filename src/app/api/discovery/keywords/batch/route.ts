/**
 * 词库批量状态操作(M31 验收反馈):activate→active(记 confirmedAt)/
 * dismiss→dismissed,逐条镜像 setKeywordStatus(不存在跳过列原因)。守卫同
 * 单条 requireSessionActor(PAT 拒)。
 */
import { type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { setKeywordStatus } from "@/lib/discovery/keywords";
import { batchIdsSchema, dedupeIds, type BatchOutcome } from "@/lib/http/batch";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage discovery keywords";

const Body = z.object({
  ids: batchIdsSchema(),
  action: z.enum(["activate", "dismiss"]),
});

const ACTION_STATUS = { activate: "active", dismiss: "dismissed" } as const;

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
      await setKeywordStatus(BigInt(id), status);
      out.updated += 1;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        out.skipped.push({ id, reason: "不存在" });
        continue;
      }
      throw e;
    }
  }
  logger.info({
    event: "discovery.keyword_batch_status",
    operatorId: actor.sub,
    action: parsed.data.action,
    total: ids.length,
    updated: out.updated,
  });
  return apiEnvelope(0, "ok", out);
}
