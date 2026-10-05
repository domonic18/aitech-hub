/**
 * SEO 自动补全(2026-10-06 验收反馈问题7):文章编辑器「高级选项」的 SEO 标题/
 * 描述一键按文章字段生成。同步 Route Handler 内调 LLM——编辑器交互式补全是用户
 * 主动等待的轻调用(单次 chat,超时受模型 timeoutSec 约束),不进 BullMQ。
 * 复用 summarize 角色绑定(生产已在用,零额外配置);未绑定/全停用抛
 * AiAdminError("disabled") 由路由映射 400 明示去 AI 配置。
 * 契约:seoTitle ≤30 字 / seoDescription ≤80 字(prompt 侧编辑规格);超长在
 * 代码层截到 DB 列帽(POST_LIMITS 255/500)内,不整条判废——编辑器填充场景
 * 宁可给可用值。JSON 提炼与 interpret/summarize 同款(extractJsonBlock 共用)。
 */
import { z } from "zod";

import { POST_LIMITS } from "../content/post-schema";
import { AI_PURPOSE_SUMMARIZE } from "./constants";
import { AI_USAGE_ROLE_SEO } from "./usage-log";
import { chatJsonTask, type ParsedTask } from "./chat-json-task";
import { extractJsonBlock } from "./interpret-result";
import { AiAdminError } from "./errors";
import { resolveAiModel } from "./resolver";

export const seoSuggestResultSchema = z.object({
  seoTitle: z.string().trim().min(1),
  seoDescription: z.string().trim().min(1),
});

export type SeoSuggestResult = z.infer<typeof seoSuggestResultSchema>;

/** 解析失败只回错误串(chatJsonTask 据此重试),永不 throw */
export function parseSeoSuggest(raw: string): ParsedTask<SeoSuggestResult> {
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
  const parsed = seoSuggestResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `结构不符:${parsed.error.issues[0]?.message ?? "unknown"}`.slice(0, 300),
    };
  }
  return {
    ok: true,
    data: {
      seoTitle: parsed.data.seoTitle.slice(0, POST_LIMITS.seoTitle),
      seoDescription: parsed.data.seoDescription.slice(0, POST_LIMITS.seoDescription),
    },
  };
}

/** 路由入参边界校验(编辑器字段快照;正文超长在 prompt 侧取样,不整拒) */
export const seoSuggestInputSchema = z.object({
  title: z.string().trim().max(POST_LIMITS.title).default(""),
  contentMd: z.string().max(POST_LIMITS.contentMd).default(""),
  excerpt: z.string().trim().max(POST_LIMITS.excerpt).default(""),
  tags: z.array(z.string().trim().max(POST_LIMITS.tag)).max(POST_LIMITS.tagsMax).default([]),
  categorySlug: z.string().trim().max(100).default(""),
});

export type SeoSuggestInput = z.infer<typeof seoSuggestInputSchema>;

export interface SeoSuggestPromptSource {
  title: string;
  contentMd: string;
  excerpt: string;
  tags: string[];
  categorySlug: string;
}

/** 正文取样上限(SEO 只需主题级理解,超长徒增 token;与编辑器客户端截断同口径) */
export const SEO_CONTENT_SAMPLE_MAX = 4000;

const OUTPUT_SPEC =
  "输出一个 JSON 对象,字段:seoTitle(SEO 标题,不超过30个字,含文章核心关键词," +
  "与文章标题不同表述、不堆砌)、seoDescription(SEO 描述,不超过80个字,一句话概括" +
  "文章解决的问题或结论,吸引搜索者点击)。只输出 JSON,不要解释、前后缀或代码围栏;" +
  "不编造正文没有的信息;全部内容使用简体中文(专有名词/产品名保留原文)。";

export function buildSeoSuggestPrompt(src: SeoSuggestPromptSource): {
  system: string;
  user: string;
} {
  const meta = [
    `标题:${src.title.trim() || "(无)"}`,
    `分类:${src.categorySlug.trim() || "(无)"}`,
    `标签:${src.tags.length > 0 ? src.tags.join("、") : "(无)"}`,
    `摘要:${src.excerpt.trim() || "(无)"}`,
  ].join("\n");
  const content = src.contentMd.trim().slice(0, SEO_CONTENT_SAMPLE_MAX);
  if (content) {
    return {
      system: `你是科技资讯网站的 SEO 编辑,基于文章字段生成搜索引擎结果页的标题与描述。${OUTPUT_SPEC}`,
      user: `${meta}\n——正文(可能截断)——\n${content}`,
    };
  }
  return {
    system: `你是科技资讯网站的 SEO 编辑,仅基于标题/分类/标签/摘要生成搜索引擎结果页的标题与描述。${OUTPUT_SPEC}`,
    user: meta,
  };
}

/** 一键补全主入口(路由消费):绑定缺失抛 disabled,LLM/解析错误原样上抛 */
export async function suggestSeo(src: SeoSuggestInput): Promise<SeoSuggestResult> {
  const model = await resolveAiModel(AI_PURPOSE_SUMMARIZE);
  if (!model) {
    throw new AiAdminError(
      "disabled",
      "未绑定或未启用「摘要(summarize)」模型:先到 AI 配置完成任务绑定",
    );
  }
  const { system, user } = buildSeoSuggestPrompt(src);
  return chatJsonTask(model, parseSeoSuggest, system, user, AI_USAGE_ROLE_SEO);
}
