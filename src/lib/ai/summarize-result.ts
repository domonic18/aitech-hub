/**
 * 文字摘要契约(M12 批③,summarize 角色首个消费方):RSS 文字条 → 一句话中心
 * 思想 + 关键词。summary ≤120 字(展示于电报流带/时间轴单行);keywords 3-5 个
 * 落 ai_points(JSON 列,复用视频要点列,读侧 toVideoAi 白名单截 5 条)。
 * JSON 提炼与 interpret 同款(剥围栏取平衡片段,代码在 interpret-result 共用)。
 */
import { z } from "zod";

import { extractJsonBlock } from "./interpret-result";
import type { ParsedTask } from "./chat-json-task";

export const summarizeResultSchema = z.object({
  summary: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().min(1).max(30)).min(3).max(5),
});

export type SummarizeResult = z.infer<typeof summarizeResultSchema>;

/** 解析失败只回错误串(处理器落 lastAiError),永不 throw */
export function parseSummarizeResult(raw: string): ParsedTask<SummarizeResult> {
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
  const parsed = summarizeResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `结构不符:${parsed.error.issues[0]?.message ?? "unknown"}`.slice(0, 300),
    };
  }
  return { ok: true, data: parsed.data };
}

export interface SummarizePromptSource {
  title: string;
  /** 库内规则截断摘要(RSS summaryCandidate,≤160 字) */
  summary: string;
  /** 摘要过短时抓取的原文粗提取(剥标签截 4k 字);null = 抓取失败/未触发,降级仅用标题+摘要 */
  content: string | null;
}

const OUTPUT_SPEC =
  "输出一个 JSON 对象,字段:summary(一句话中心思想,不超过60个字,说清这条资讯的核心事实)、" +
  "keywords(关键词数组,3到5个,每个不超过12个字,从内容中提取,不要生造)。" +
  "只输出 JSON,不要解释、前后缀或代码围栏;概括而非复述;" +
  "不编造材料中没有的信息;全部用简体中文。";

export function buildSummarizePrompt(src: SummarizePromptSource): { system: string; user: string } {
  const meta = `标题:${src.title.trim() || "(无)"}\n摘要:${src.summary.trim() || "(无)"}`;
  if (src.content) {
    return {
      system: `你是科技资讯编辑,为入库资讯条目提炼一句话中心思想与关键词。${OUTPUT_SPEC}`,
      user: `${meta}\n——正文粗提取(可能截断)——\n${src.content}`,
    };
  }
  return {
    system: `你是科技资讯编辑,为入库资讯条目提炼一句话中心思想与关键词。仅基于标题与摘要提炼。${OUTPUT_SPEC}`,
    user: meta,
  };
}
