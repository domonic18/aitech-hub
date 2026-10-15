/**
 * POST /api/posts/cover-generate(M14 批⑥,验收反馈问题6):编辑器「AI 生成候选」
 * 入队生图 job(202;生图 10-30s 走 worker 不占请求)。会话鉴权(编辑器交互面);
 * cover 绑定缺失 → 400 明示去 AI 配置。轮询走 GET /api/posts/cover-generate/[jobId]。
 * M31 验收反馈:编辑态上下文服务端直读库(标签数不限,任意文章可生成);空
 * prompt 由 worker 侧 agent 概要提取(失败回退模板)。
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { enqueueCoverGen, loadCoverPostContext } from "@/lib/ai/cover-generate";
import { AiAdminError, aiErrorStatus } from "@/lib/ai/errors";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { POST_LIMITS } from "@/lib/content/post-schema";

export const dynamic = "force-dynamic";

const coverGenInputSchema = z.object({
  title: z.string().trim().max(POST_LIMITS.title).default(""),
  excerpt: z.string().trim().max(POST_LIMITS.excerpt).default(""),
  /** 不限个数(50 兜底):主题稿标签可超编辑器 5 枚上限;编辑态服务端直读库,本字段仅创建态兜底 */
  tags: z.array(z.string().trim().max(POST_LIMITS.tag)).max(50).default([]),
  /** 正文 markdown(创建态编辑器取样;编辑态服务端直读库内正文) */
  contentMd: z.string().max(POST_LIMITS.contentMd).default(""),
  /** 生图 prompt(可空:空串走 agent 概要提取,再兜底服务端模板) */
  prompt: z.string().trim().max(2000).default(""),
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

  // 编辑态:上下文以库内文章为真相源(任意文章可生成,客户端快照可能过期)
  let ctx = {
    title: parsed.data.title,
    excerpt: parsed.data.excerpt,
    tags: parsed.data.tags,
    contentMd: parsed.data.contentMd,
  };
  if (parsed.data.postId !== undefined) {
    const dbCtx = await loadCoverPostContext(parsed.data.postId);
    if (!dbCtx) return apiEnvelope(404, "文章不存在或已删除");
    ctx = dbCtx;
  }
  if (ctx.title === "") {
    return apiEnvelope(400, "标题为空,无法生成封面(先填标题)");
  }

  try {
    const r = await enqueueCoverGen({
      token: parsed.data.token ?? randomUUID(),
      postId: parsed.data.postId ?? null,
      ...ctx,
      prompt: parsed.data.prompt,
    });
    return apiEnvelope(0, "accepted", r, 202);
  } catch (err) {
    if (err instanceof AiAdminError) {
      return apiEnvelope(aiErrorStatus(err.code), err.message);
    }
    throw err;
  }
}
