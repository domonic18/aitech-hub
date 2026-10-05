/**
 * 文字摘要契约(M12 批③;批⑥ 2026-10-05 验收反馈改 v2):RSS 文字条 →
 * 一句话中心思想 + 要点 + 关键词。summary ≤120 字(带/时间轴单行);points 2-4 条
 * 分列关键事实(落 ai_points,对齐视频要点语义);keywords 3-5 个落 ai_keywords
 * (批⑥ 新列;此前塞 ai_points 是契约换列前的过渡)。泛词禁令双保险:prompt 明令
 * + 代码层过滤(「AI」「人工智能」全站皆有的词做 tag 恒无区分度),滤光判不符,
 * 借 chatJsonTask 解析重试把禁令反馈给模型。
 * JSON 提炼与 interpret 同款(剥围栏取平衡片段,代码在 interpret-result 共用)。
 */
import { z } from "zod";

import { extractJsonBlock } from "./interpret-result";
import type { ParsedTask } from "./chat-json-task";

/** 全站皆 AI,这类词当关键词恒无区分度(小写归一后精确比对,不误伤「AI 眼镜」类具体词) */
const GENERIC_KEYWORDS = new Set(["ai", "人工智能", "artificial intelligence"]);

export const summarizeResultSchema = z.object({
  summary: z.string().trim().min(1).max(120),
  points: z.array(z.string().trim().min(1).max(120)).min(2).max(4),
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
  const keywords = parsed.data.keywords.filter(
    (k) => !GENERIC_KEYWORDS.has(k.trim().toLowerCase()),
  );
  if (keywords.length === 0) {
    return {
      ok: false,
      error: "keywords 全为「AI/人工智能」级泛词:须从内容抽象具体关键字(公司/产品/技术/事件)",
    };
  }
  return { ok: true, data: { ...parsed.data, keywords } };
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
  "points(要点数组,2到4条,每条不超过40个字,分条列出关键事实、数据或结论)、" +
  "keywords(关键词数组,3到5个,每个不超过12个字,从内容抽象出的具体关键字," +
  "如公司名、产品名、技术、人物、事件;禁止输出「AI」「人工智能」这类全站通用的泛词)。" +
  "只输出 JSON,不要解释、前后缀或代码围栏;概括而非复述;" +
  "不编造材料中没有的信息;输入可能是英文等外语,summary、points、keywords 必须翻译成简体中文输出" +
  "(M14:外刊渠道入库后面向中文读者,禁止整段照抄外语原文;公司/产品/模型等专有名词保留原文)," +
  "全部内容使用简体中文。";

export function buildSummarizePrompt(src: SummarizePromptSource): { system: string; user: string } {
  const meta = `标题:${src.title.trim() || "(无)"}\n摘要:${src.summary.trim() || "(无)"}`;
  if (src.content) {
    return {
      system: `你是科技资讯编辑,为入库资讯条目提炼一句话中心思想、要点与关键词。${OUTPUT_SPEC}`,
      user: `${meta}\n——正文粗提取(可能截断)——\n${src.content}`,
    };
  }
  return {
    system: `你是科技资讯编辑,为入库资讯条目提炼一句话中心思想、要点与关键词。仅基于标题与摘要提炼。${OUTPUT_SPEC}`,
    user: meta,
  };
}
