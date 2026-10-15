/**
 * 用户批量启停(M31 验收反馈):逐条镜像 PUT /api/users/[id]/status 语义
 * (setUserStatus,停用连带吊销全部 PAT);当前登录账号跳过列原因(防自锁,
 * 客户端已禁勾仍服务端兜底)。守卫同单条 requireSessionActor(PAT 拒)。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { UserAdminError, setUserStatus } from "@/lib/users/admin-users";
import { USER_STATUS_MUTABLE } from "@/lib/users/user-status";
import { batchIdsSchema, dedupeIds, type BatchOutcome } from "@/lib/http/batch";

export const dynamic = "force-dynamic";

const PAT_DENY = "PAT must not manage users";
const Body = z.object({
  ids: batchIdsSchema(),
  status: z.enum(USER_STATUS_MUTABLE),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, PAT_DENY);
  if (actor.kind === "reject") return actor.response;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const ids = dedupeIds(parsed.data.ids);
  const out: BatchOutcome = { updated: 0, skipped: [] };
  for (const id of ids) {
    if (BigInt(id) === BigInt(actor.sub)) {
      out.skipped.push({ id, reason: "当前登录账号" });
      continue;
    }
    try {
      await setUserStatus(BigInt(id), parsed.data.status);
      out.updated += 1;
    } catch (e) {
      if (!(e instanceof UserAdminError)) throw e;
      out.skipped.push({ id, reason: e.code === "not_found" ? "不存在" : e.code });
    }
  }
  logger.info({
    event: "users.batch_status",
    operatorId: actor.sub,
    status: parsed.data.status,
    total: ids.length,
    updated: out.updated,
  });
  return apiEnvelope(0, "ok", out);
}
