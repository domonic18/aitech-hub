/**
 * POST /api/distribute/wechat/batch(M17 批④):文章管理多选批量同步公众号草稿
 * 入队(202)。会话鉴权(PAT 拒);逐篇预检在 enqueueWechatBatch——旧文/缺封面/
 * pending/不存在进 skipped(202 携带人话),合格者单 job 顺序逐篇。
 * 进度凭 token 轮询 GET /api/distribute/wechat/batch/[jobId]。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { DISTRIBUTE_BATCH_MAX } from "@/lib/distribute/channels";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { enqueueWechatBatch } from "@/lib/distribute/wechat-sync";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const batchInputSchema = z.object({
  ids: z
    .array(z.string().regex(/^\d{1,19}$/))
    .min(1)
    .max(DISTRIBUTE_BATCH_MAX),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能批量同步公众号草稿");
  if (actor.kind === "reject") return actor.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = batchInputSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const ids = [...new Set(parsed.data.ids)]; // 同篇重复勾选不重复推

  try {
    const r = await enqueueWechatBatch(ids);
    return apiEnvelope(0, "accepted", { ...r, total: ids.length }, 202);
  } catch (err) {
    if (err instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(err.code), err.message);
    }
    throw err;
  }
}
