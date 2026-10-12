/**
 * 解读笔记(M26 批②,docs/plan/topic-pipeline-plan.md §4):interpreter job 内
 * 第二次 LLM 调用专产分析笔记(800~1500 字结构化 markdown),与既有 interpret
 * 契约(aiTopic/aiSummary/aiPoints)零耦合——prompt 独立迭代,失败置 null 不阻塞
 * 解读终态。「转写即删」红线不变:转写文本只经本模块 prompt 在 job 内存过境,
 * 笔记是分析产物而非转写存储;无转写的文案降级轮次不产笔记(缺时间线叙事材料,
 * 不硬凑——同存量不补口径)。
 */
import { z } from "zod";

import { AI_PURPOSE_INTERPRET, AI_ERR_DETAIL_MAX } from "./constants";
import { chatJsonTask, type ParsedTask } from "./chat-json-task";
import { extractJsonBlock } from "./interpret-result";
import { logger } from "../logger";
import type { ResolvedAiModel } from "./resolver";

/** 笔记输出契约:单字段 JSON 包裹(复用 chatJson 的 response_format 强约束与
 * extractJsonBlock 围栏提炼);min=300 为垃圾输出底线(编辑规格 800~1500 字由
 * prompt 侧约束,契约层不做编辑判断),max=4000 为契约漂移护栏(DB 列 TEXT 无帽) */
export const interpretNoteSchema = z.object({
  note: z.string().trim().min(300, "笔记过短").max(4000, "笔记超长"),
});

export type InterpretNote = z.infer<typeof interpretNoteSchema>;

/** 解析失败只回错误串(调用方降级 null),永不 throw */
export function parseInterpretNote(raw: string): ParsedTask<InterpretNote> {
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
  const parsed = interpretNoteSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `结构不符:${parsed.error.issues[0]?.message ?? "unknown"}`.slice(0, 300),
    };
  }
  return { ok: true, data: parsed.data };
}

export interface InterpretNotePromptSource {
  title: string | null;
  caption: string | null;
  /** ASR 转写全文(必传:无转写轮次由调用方整体跳过,不进入本模块) */
  transcript: string;
}

const NOTE_SPEC =
  "写一篇 800~1500 字的结构化 markdown 解读笔记,依次包含四个小节(## 二级标题):" +
  "「背景与问题」(这条视频回应什么背景或痛点,信息出自谁);" +
  "「核心要点」(按视频叙事顺序展开 2~4 个要点,保留关键数据、产品名、结论等硬信息);" +
  "「做法与配置」(视频给出可操作步骤/工具/参数时逐条列出,没有则写「视频未涉及具体操作步骤」);" +
  "「适用人群与局限」(谁该关注,结论有何边界或存疑处)。" +
  "写作纪律:只依据转写与文案材料,不编造;时间/年份表述必须取自材料原文,材料未提就写「近期」,不得自行推断年份;提炼分析而非逐句复述;全部用简体中文。";

export function buildInterpretNotePrompt(src: InterpretNotePromptSource): {
  system: string;
  user: string;
} {
  return {
    system:
      `你是科技内容编辑,为入库短视频撰写「解读笔记」——供后续 AI 合成专题文章使用的` +
      `分析素材,不是摘要复述。基于视频转写全文,${NOTE_SPEC}` +
      `输出一个 JSON 对象,字段 note 为笔记全文字符串;只输出 JSON,不要解释、前后缀或代码围栏。`,
    user: [
      `标题:${src.title?.trim() || "(无)"}`,
      `口播文案:${src.caption?.trim() || "(无)"}`,
      "——视频转写全文——",
      src.transcript,
    ].join("\n"),
  };
}

/** job 级重试(方案 §4「当轮重试 1 次」;chatJsonTask 内部另有解析重试一层);
 * 终败返回 note=null,调用方落库 null 不阻塞解读终态。usage 记 role=interpret
 * (方案 §4:台账自然覆盖)。输出预算放大:800~1500 字 markdown 超 chatJsonTask
 * 缺省 2000,截断即废 JSON */
const NOTE_RETRIES = 1;
const NOTE_MAX_TOKENS = 4000;

export async function runInterpretNote(
  model: ResolvedAiModel,
  src: InterpretNotePromptSource,
): Promise<{ note: string | null; error: string | null }> {
  const prompt = buildInterpretNotePrompt(src);
  let lastError = "";
  for (let attempt = 0; attempt <= NOTE_RETRIES; attempt++) {
    try {
      const { note } = await chatJsonTask(
        model,
        parseInterpretNote,
        prompt.system,
        prompt.user,
        AI_PURPOSE_INTERPRET,
        { maxTokens: NOTE_MAX_TOKENS },
      );
      return { note, error: null };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn({
        event: "interpret.video.note_retry",
        attempt: attempt + 1,
        error: lastError.slice(0, AI_ERR_DETAIL_MAX),
      });
    }
  }
  return { note: null, error: lastError };
}
