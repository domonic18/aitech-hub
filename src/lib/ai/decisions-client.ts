/**
 * System One 决策模型客户端(M53 批A;typesafe/jev 经 OpenRouter Decisions API):
 * 输入应用状态(state)+ 类型化问题(questions),输出带概率/置信的类型化决策。
 * 与 llm-client(openai/anthropic chat)并列的第三条调用面——决策模型不产文本,
 * 用于打标批的「判定半场」(舆情倾向/hot·pain 覆判)。
 *
 * wire(官方文档核实):POST {baseUrl}/alpha/decisions
 *   body = { model, state: (string|image)[], questions: { 名: {type, options|criteria} } }
 *   resp = { answers: { 名: { type, answer|probability, confidence } }, usage: { cost } }
 * 仅输入 token 计费,输出免费;context 262k。
 */
import { authHeaders } from "./probe-shared";

export interface JevChoiceQuestion {
  type: "choice";
  /** 选项 → 判定指引(每选项一句「什么样算这个选项」;官方 ticket 分诊同构) */
  criteria: Record<string, string>;
  /** 指令(问题句) */
  instructions: string;
}

export interface JevNoulQuestion {
  type: "noul";
  /** 成立/不成立各自的判定指引(官方 schema 为 true/false 双键对象) */
  criteria: { true: string; false: string };
  /** 指令(问题句) */
  instructions: string;
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion;

export interface JevAnswer {
  type: string;
  /** choice:选中选项 */
  choice?: string;
  /** noul:成立概率 0-1 */
  noul?: number;
  confidence: number | null;
  probabilities?: Record<string, number>;
}

export interface DecideResult {
  answers: Record<string, JevAnswer>;
  usageCost: number | null;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

/** 决策请求(永不抛网络/HTTP 异常以外的错;异常以 JevError 上抛由调用方降级) */
export async function decideQuestions(input: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  /** 应用状态:文本段(与 image_url 形态的字符串混排;截图判定暂未用) */
  state: string[];
  questions: Record<string, JevQuestion>;
  timeoutMs?: number;
}): Promise<DecideResult> {
  const res = await fetch(`${input.baseUrl}/alpha/decisions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(input.apiKey),
    },
    body: JSON.stringify({
      model: input.model,
      state: input.state,
      questions: input.questions,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new JevError(`Decisions API ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  const json = (await res.json().catch(() => null)) as {
    answers?: Record<string, Record<string, unknown>>;
    usage?: { cost?: unknown };
  } | null;
  if (!json?.answers) throw new JevError("Decisions API 响应缺 answers", res.status);
  const answers: Record<string, JevAnswer> = {};
  for (const [name, a] of Object.entries(json.answers)) {
    answers[name] = {
      type: typeof a.type === "string" ? a.type : "unknown",
      ...(typeof a.choice === "string" ? { choice: a.choice } : {}),
      ...(typeof a.noul === "number" ? { noul: a.noul } : {}),
      confidence: typeof a.confidence === "number" ? a.confidence : null,
      ...(a.probabilities !== null && typeof a.probabilities === "object"
        ? {
            probabilities: Object.fromEntries(
              Object.entries(a.probabilities as Record<string, unknown>).map(([k, v]) => [
                k,
                typeof v === "number" ? v : Number(v),
              ]),
            ),
          }
        : {}),
    };
  }
  return {
    answers,
    usageCost: typeof json.usage?.cost === "number" ? json.usage.cost : null,
  };
}
