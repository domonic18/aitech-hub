/**
 * 解读结果契约(M9 批②):LLM 输出 → Zod 结构化(topic/summary/points),
 * 容错剥代码围栏/前后噪声后取首个平衡 {} 片段。schema 上限对齐 DB 列帽
 * (ai_topic 50/ai_summary 1000/points ≤3×120);prompt 侧要求更紧的编辑规格。
 */
import { z } from "zod";

export const interpretResultSchema = z.object({
  topic: z.string().trim().min(1).max(50),
  summary: z.string().trim().min(1).max(1000),
  points: z.array(z.string().trim().min(1).max(120)).max(3),
});

export type InterpretResult = z.infer<typeof interpretResultSchema>;

export type ParsedInterpret = { ok: true; data: InterpretResult } | { ok: false; error: string };

/** 剥 ```json 围栏,取首个平衡 {} 片段(字符串内的引号/花括号感知);
 * summarize-result 共用(M12 批③) */
export function extractJsonBlock(raw: string): string | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 解析失败只回错误串(处理器落 lastAiError),永不 throw */
export function parseInterpretResult(raw: string): ParsedInterpret {
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
  const parsed = interpretResultSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `结构不符:${parsed.error.issues[0]?.message ?? "unknown"}`.slice(0, 300),
    };
  }
  return { ok: true, data: parsed.data };
}

export interface InterpretPromptSource {
  title: string | null;
  caption: string | null;
  topicTags: string[];
  /** ASR 转写全文;null = 转写缺失(降级:仅基于公开文案元数据概括,不触红线) */
  transcript: string | null;
}

const OUTPUT_SPEC =
  "输出一个 JSON 对象,字段:topic(视频主题,不超过20个字)、" +
  "summary(内容概括,120~200字,讲清这条视频说了什么)、" +
  "points(关键要点数组,最多3条,每条不超过50字)。" +
  "只输出 JSON,不要解释、前后缀或代码围栏;概括而非复述;" +
  "不编造材料中没有的信息;全部用简体中文。";

export function buildInterpretPrompt(src: InterpretPromptSource): { system: string; user: string } {
  const tags = src.topicTags.length ? `话题标签:${src.topicTags.join("、")}` : "";
  const meta = [
    `标题:${src.title?.trim() || "(无)"}`,
    tags,
    `口播文案:${src.caption?.trim() || "(无)"}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (src.transcript) {
    return {
      system: `你是科技资讯编辑,为入库短视频撰写摘要。${OUTPUT_SPEC}`,
      user: `${meta}\n——视频转写全文——\n${src.transcript}`,
    };
  }
  return {
    system:
      `你是科技资讯编辑,为入库短视频撰写摘要。本次没有视频转写文本,` +
      `仅基于标题、文案与话题标签概括,summary 需以「(基于文案)」开头。${OUTPUT_SPEC}`,
    user: meta,
  };
}
