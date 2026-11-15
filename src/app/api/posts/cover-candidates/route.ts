/**
 * POST /api/posts/cover-candidates(D3,2026-11-15):封面候选的 HTTP 触发面。
 *
 * 由来:封面生成原先 100% 由站内 agent 工具发起,全站没有第二条触发路径——
 * agent 工具下线后编辑器就彻底失去后端。本路由给编辑器一条不依赖 agent 的
 * 触发通道(D3 裁定「站内 AI 封面留,改为 HTTP 触发」)。
 *
 * 流程与 agent 工具同一份编排(`lib/ai/cover-candidates.ts`):入队生图(hold,
 * 不进媒体库)→ 轮询等候选 → 返回候选 id 与预览路径;预览取图走
 * `GET /api/posts/cover-candidates/[id]/raw`(token 走 x-cover-token 头),
 * 确认入库走 `POST /api/posts/cover-candidates/[id]/adopt`,放弃走
 * `DELETE /api/posts/cover-candidates`。
 *
 * 鉴权:仅会话(admin 编辑器交互面);PAT 拒——生图按张计费,不向外部通道开口子。
 */
import { type NextRequest } from "next/server";

import { discardCoverCandidates, requestCoverCandidates } from "@/lib/ai/cover-candidates";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";

export const dynamic = "force-dynamic";

/** 生图 prompt 上限(与 agent 工具同口径) */
const PROMPT_MAX = 2000;

export async function POST(req: NextRequest): Promise<Response> {
  const actor = await requireSessionActor(req, "PAT 不能触发生成封面");
  if (actor.kind === "reject") return actor.response;

  let body: { postId?: unknown; prompt?: unknown };
  try {
    body = (await req.json()) as { postId?: unknown; prompt?: unknown };
  } catch {
    return apiEnvelope(400, "请求体不是合法 JSON");
  }
  const postId = typeof body.postId === "string" ? body.postId.trim() : "";
  if (!/^\d+$/.test(postId)) return apiEnvelope(400, "postId 缺失或不合法");
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length > PROMPT_MAX) return apiEnvelope(400, `prompt 超过 ${PROMPT_MAX} 字上限`);

  const outcome = await requestCoverCandidates({ postId, prompt });
  if (!outcome.ok) {
    const status = outcome.reason === "not_found" ? 404 : 502;
    return apiEnvelope(status, outcome.message, { reason: outcome.reason });
  }
  return apiEnvelope(0, "ok", {
    token: outcome.token,
    candidates: outcome.candidates,
  });
}

/**
 * DELETE /api/posts/cover-candidates:放弃整批候选(清临时件,不入库)。
 * token 走 x-cover-token 头(query 会落访问/代理日志,同预览路由口径)。
 */
export async function DELETE(req: NextRequest): Promise<Response> {
  const actor = await requireSessionActor(req, "PAT 不能丢弃封面候选");
  if (actor.kind === "reject") return actor.response;

  const token = req.headers.get("x-cover-token") ?? "";
  if (!/^[0-9a-f-]{8,64}$/.test(token)) return apiEnvelope(400, "token 缺失或不合法");

  await discardCoverCandidates(token);
  return apiEnvelope(0, "ok");
}
