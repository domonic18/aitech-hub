/**
 * POST /api/posts/cover-generate(M14 批⑥,验收反馈问题6):编辑器「AI 生成候选」
 * 入队生图 job(202;生图 10-30s 走 worker 不占请求)。会话鉴权(编辑器交互面);
 * cover 绑定缺失 → 400 明示去 AI 配置。轮询走 GET /api/posts/cover-generate/[jobId]。
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { enqueueCoverGen } from "@/lib/ai/cover-generate";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { POST_LIMITS } from "@/lib/content/post-schema";

export const dynamic = "force-dynamic";

const coverGenInputSchema = z.object({
  title: z.string().trim().max(POST_LIMITS.title).default(""),
  excerpt: z.string().trim().max(POST_LIMITS.excerpt).default(""),
  tags: z.array(z.string().trim().max(POST_LIMITS.tag)).max(POST_LIMITS.tagsMax).default([]),
  /** 编辑态文章 id(数字串);创建态缺省 */
  postId: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
  /** 编辑器生成会话令牌(缺省生成新) */
  token: z
    .string()
    .regex(/^[0-9a-f-]{8,64}$/)
    .optional(),
});

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能触发生图");
  if (actor.kind === "reject") return actor.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = coverGenInputSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  if (parsed.data.title === "") {
    return apiEnvelope(400, "标题为空,无法生成封面(先填标题)");
  }

  try {
    const r = await enqueueCoverGen({
      token: parsed.data.token ?? randomUUID(),
      postId: parsed.data.postId ?? null,
      title: parsed.data.title,
      excerpt: parsed.data.excerpt,
      tags: parsed.data.tags,
    });
    return apiEnvelope(0, "accepted", r, 202);
  } catch (err) {
    if (err instanceof AiAdminError) {
      return apiEnvelope(aiErrorStatus(err.code), err.message);
    }
    throw err;
  }
}
