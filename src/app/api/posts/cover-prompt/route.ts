/**
 * POST /api/posts/cover-prompt(2026-10-06 M16 验收反馈问题2):封面弹窗
 * 「AI 生成提示词」——LLM 分析标题/摘要/标签/正文取样产出文生图 prompt。
 * 会话鉴权(PAT 不代理编辑器交互);复用 summarize 绑定,未绑定 → 400 明示;
 * LLM 网络/解析失败 → 502 透传摘要。产出到前端 prompt 框,用户改后再生成。
 */
import { type NextRequest } from "next/server";

import { suggestCoverPrompt, coverPromptInputSchema } from "@/lib/ai/cover-prompt-suggest";
import { loadCoverPostContext } from "@/lib/ai/cover-generate";
import { AiAdminError, AiClientError, aiErrorStatus } from "@/lib/ai/errors";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能调用封面 prompt 建议");
  if (actor.kind === "reject") return actor.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = coverPromptInputSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }

  // 编辑态:上下文以库内文章为真相源(全部标签+正文,客户端快照可能过期)
  let src = {
    title: parsed.data.title,
    contentMd: parsed.data.contentMd,
    excerpt: parsed.data.excerpt,
    tags: parsed.data.tags,
  };
  if (parsed.data.postId !== undefined) {
    const dbCtx = await loadCoverPostContext(parsed.data.postId);
    if (!dbCtx) return apiEnvelope(404, "文章不存在或已删除");
    src = dbCtx;
  }
  if (src.title === "" && src.excerpt.trim() === "") {
    return apiEnvelope(400, "标题与摘要不能同时为空,先填写再生成提示词");
  }

  try {
    const result = await suggestCoverPrompt(src);
    logger.info({
      event: "post.cover_prompt_suggested",
      titleLen: src.title.length,
      hasContent: src.contentMd.trim() !== "",
    });
    return apiEnvelope(0, "ok", result);
  } catch (err) {
    if (err instanceof AiAdminError) {
      return apiEnvelope(aiErrorStatus(err.code), err.message);
    }
    if (err instanceof AiClientError) {
      logger.warn({ event: "post.cover_prompt_suggest_failed", kind: err.kind });
      return apiEnvelope(502, `LLM 调用失败:${err.message}`.slice(0, 300));
    }
    throw err;
  }
}
