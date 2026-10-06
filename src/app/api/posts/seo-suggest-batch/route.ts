/**
 * POST /api/posts/seo-suggest-batch(M16 问题8,仅补空缺):文章管理多选批量
 * SEO 补全入队(202;LLM 逐篇秒级走 worker 不占请求)。会话鉴权(PAT 拒,
 * 编辑器交互面同口径);summarize 绑定缺失 400 明示去 AI 配置,不产生无效 job。
 * 单批次 job 顺序逐篇,进度凭 token 轮询 GET /api/posts/seo-suggest-batch/[jobId]。
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { enqueueSeoBatch } from "@/lib/ai/seo-batch";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

/** 单批上限(防误选全库;50 篇 × LLM 秒级 ≈ 分钟级,worker lockDuration 600s 兜底) */
const SEO_BATCH_MAX = 50;

const seoBatchInputSchema = z.object({
  ids: z
    .array(z.string().regex(/^\d{1,19}$/))
    .min(1)
    .max(SEO_BATCH_MAX),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能触发批量 SEO 补全");
  if (actor.kind === "reject") return actor.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = seoBatchInputSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const ids = [...new Set(parsed.data.ids)]; // 同篇重复勾选不重复计费

  try {
    const r = await enqueueSeoBatch({ token: randomUUID(), ids });
    return apiEnvelope(0, "accepted", { ...r, total: ids.length }, 202);
  } catch (err) {
    if (err instanceof AiAdminError) {
      return apiEnvelope(aiErrorStatus(err.code), err.message);
    }
    throw err;
  }
}
