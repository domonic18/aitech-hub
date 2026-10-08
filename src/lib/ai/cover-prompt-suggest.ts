/**
 * 封面生图 prompt 建议(2026-10-06 M16 验收反馈问题2):编辑器封面弹窗
 * 「AI 生成提示词」——LLM 对标题/摘要/标签(及正文取样)分析后产出一句话
 * 文生图 prompt,填入弹窗 prompt 框供用户改后再生成。同步 Route Handler 内
 * 调 LLM(单次 chat,交互式轻调用,同 seo-suggest 口径);复用 summarize
 * 角色绑定,未绑定/全停用抛 AiAdminError("disabled") 由路由映射 400。
 * 输出契约:单个 JSON {prompt},≤600 字,横版 16:9 封面描述;超长截断不整废。
 */
import { z } from "zod";

import { POST_LIMITS } from "../content/post-schema";
import { AI_PURPOSE_SUMMARIZE } from "./constants";
import { AI_USAGE_ROLE_COVER_PROMPT } from "./usage-log";
import { chatJsonTask, type ParsedTask } from "./chat-json-task";
import { extractJsonBlock } from "./interpret-result";
import { AiAdminError } from "./errors";
import { resolveAiModel } from "./resolver";

export const coverPromptResultSchema = z.object({
  prompt: z.string().trim().min(1),
});

export type CoverPromptResult = z.infer<typeof coverPromptResultSchema>;

/** 生图 prompt 帽(与 cover-generate 路由入参同口径) */
export const COVER_PROMPT_MAX = 600;

/** 解析失败只回错误串(chatJsonTask 据此重试),永不 throw */
export function parseCoverPrompt(raw: string): ParsedTask<CoverPromptResult> {
  const block = extractJsonBlock(raw);
  if (!block) return { ok: false, error: "输出中未找到 JSON 对象" };
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败:${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
    };
  }
  const parsed = coverPromptResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `结构不符:${parsed.error.issues[0]?.message ?? "unknown"}`.slice(0, 300),
    };
  }
  return { ok: true, data: { prompt: parsed.data.prompt.slice(0, COVER_PROMPT_MAX) } };
}

/** 路由入参边界校验(编辑器字段快照;正文超长在 prompt 侧取样,不整拒) */
export const coverPromptInputSchema = z.object({
  title: z.string().trim().max(POST_LIMITS.title).default(""),
  contentMd: z.string().max(POST_LIMITS.contentMd).default(""),
  excerpt: z.string().trim().max(POST_LIMITS.excerpt).default(""),
  tags: z.array(z.string().trim().max(POST_LIMITS.tag)).max(POST_LIMITS.tagsMax).default([]),
});

export type CoverPromptInput = z.infer<typeof coverPromptInputSchema>;

export interface CoverPromptSource {
  title: string;
  contentMd: string;
  excerpt: string;
  tags: string[];
}

/** 正文取样上限(画面主题级理解足矣,与 seo-suggest 同口径) */
export const COVER_PROMPT_CONTENT_SAMPLE_MAX = 4000;

const OUTPUT_SPEC =
  `输出一个 JSON 对象,字段:prompt(文生图提示词,不超过${COVER_PROMPT_MAX}字)。` +
  "prompt 要求:一句连贯的中文画面描述,适合CogView/DALL-E类文生图模型;" +
  "包含画面主体、场景氛围、艺术风格、配色与构图(横版 16:9 封面);" +
  "明确写出「画面中不出现任何文字、字母、水印、logo」;" +
  "只描述画面,不要输出标题、解释、引号或代码围栏;" +
  "不编造正文没有的事物;全部使用简体中文(专有名词保留原文)。";

export function buildCoverPromptSuggestPrompt(src: CoverPromptSource): {
  system: string;
  user: string;
} {
  const meta = [
    `标题:${src.title.trim() || "(无)"}`,
    `标签:${src.tags.length > 0 ? src.tags.join("、") : "(无)"}`,
    `摘要:${src.excerpt.trim() || "(无)"}`,
  ].join("\n");
  const content = src.contentMd.trim().slice(0, COVER_PROMPT_CONTENT_SAMPLE_MAX);
  if (content) {
    return {
      system: `你是科技资讯网站的封面美术编辑,基于文章内容为文生图模型写画面提示词。${OUTPUT_SPEC}`,
      user: `${meta}\n——正文(可能截断)——\n${content}`,
    };
  }
  return {
    system: `你是科技资讯网站的封面美术编辑,仅基于标题/标签/摘要为文生图模型写画面提示词。${OUTPUT_SPEC}`,
    user: meta,
  };
}

/** 一键建议主入口(路由消费):绑定缺失抛 disabled,LLM/解析错误原样上抛 */
export async function suggestCoverPrompt(src: CoverPromptInput): Promise<CoverPromptResult> {
  const model = await resolveAiModel(AI_PURPOSE_SUMMARIZE);
  if (!model) {
    throw new AiAdminError(
      "disabled",
      "未绑定或未启用「摘要(summarize)」模型:先到 AI 配置完成任务绑定",
    );
  }
  const { system, user } = buildCoverPromptSuggestPrompt(src);
  return chatJsonTask(model, parseCoverPrompt, system, user, AI_USAGE_ROLE_COVER_PROMPT);
}
