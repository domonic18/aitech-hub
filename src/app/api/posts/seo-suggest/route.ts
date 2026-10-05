/**
 * POST /api/posts/seo-suggest(2026-10-06 验收反馈问题7):编辑器 SEO 标题/描述
 * 一键 LLM 补全。会话鉴权(PAT 不代理编辑器交互,同 channels/telegram 管理面);
 * 复用 summarize 角色绑定,未绑定 → 400 明示;LLM 网络/解析失败 → 502 透传摘要。
 */
import { type NextRequest } from "next/server";

import { suggestSeo, seoSuggestInputSchema } from "@/lib/ai/seo-suggest";
import { AiAdminError, AiClientError, aiErrorStatus } from "@/lib/ai/errors";
import { requireSessionActor } from "@/lib/http/session-guard";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const actor = await requireSessionActor(req, "PAT 不能调用编辑器 SEO 补全");
  if (actor.kind === "reject") return actor.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = seoSuggestInputSchema.safeParse(raw);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  if (parsed.data.title === "" && parsed.data.contentMd.trim() === "") {
    return apiEnvelope(400, "标题与正文不能同时为空,先填写再生成");
  }

  try {
    const result = await suggestSeo(parsed.data);
    logger.info({
      event: "post.seo_suggested",
      titleLen: parsed.data.title.length,
      hasContent: parsed.data.contentMd.trim() !== "",
    });
    return apiEnvelope(0, "ok", result);
  } catch (err) {
    if (err instanceof AiAdminError) {
      return apiEnvelope(aiErrorStatus(err.code), err.message);
    }
    if (err instanceof AiClientError) {
      logger.warn({ event: "post.seo_suggest_failed", kind: err.kind });
      return apiEnvelope(502, `LLM 调用失败:${err.message}`.slice(0, 300));
    }
    throw err;
  }
}
