/**
 * POST /api/distribute/xiaohongshu/sync(M49 批X2):小红书物料准备入队(202)。
 * 会话鉴权;资格前置在 enqueueXhsPrepare——模型未绑定/旧文/pending 均 400 人话。
 * 物料进度由前端轮询 GET /api/distribute/xiaohongshu/material(状态机驱动)。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { parsePostId } from "@/lib/content/posts-admin";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { enqueueXhsPrepare } from "@/lib/distribute/xhs";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const syncInputSchema = z.object({
  postId: z.string().regex(/^\d{1,19}$/),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能生成分发物料");
  if (actor.kind === "reject") return actor.response;
  const body = syncInputSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return apiEnvelope(400, "参数无效");
  }
  try {
    const { jobId } = await enqueueXhsPrepare(BigInt(body.data.postId));
    return apiEnvelope(0, "ok", { jobId }, 202);
  } catch (e) {
    if (e instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(e.code), e.message);
    }
    throw e;
  }
}
