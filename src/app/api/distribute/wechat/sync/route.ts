/**
 * POST /api/distribute/wechat/sync(M17 批④):单篇一键同步公众号草稿入队(202)。
 * 会话鉴权(PAT 拒);资格前置在 enqueueWechatSync——未配置/旧文/缺封面/pending
 * 均 400 人话;微调覆盖值(标题/摘要/封面)可选,超限 400 拦截。
 * 进度凭 token 轮询 GET /api/distribute/wechat/sync/[jobId]。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { parsePostId } from "@/lib/content/posts-admin";
import { DistributeError, distributeErrorStatus } from "@/lib/distribute/errors";
import { enqueueWechatSync } from "@/lib/distribute/wechat-sync";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

const syncInputSchema = z.object({
  postId: z.string().regex(/^\d{1,19}$/),
  title: z.string().max(200).optional(),
  digest: z.string().max(300).optional(),
  coverPath: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能同步公众号草稿");
  if (actor.kind === "reject") return actor.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = syncInputSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const id = parsePostId(parsed.data.postId);
  if (id === null) return apiEnvelope(400, "postId 不合法");

  try {
    const { title, digest, coverPath } = parsed.data;
    const r = await enqueueWechatSync(id, {
      ...(title !== undefined ? { title } : {}),
      ...(digest !== undefined ? { digest } : {}),
      ...(coverPath !== undefined ? { coverPath } : {}),
    });
    return apiEnvelope(0, "accepted", r, 202);
  } catch (err) {
    if (err instanceof DistributeError) {
      return apiEnvelope(distributeErrorStatus(err.code), err.message);
    }
    throw err;
  }
}
