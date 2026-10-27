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
  /** 选项(答案answer=其中之一) */
  options: string[];
}

export interface JevNoulQuestion {
  type: "noul";
  /** 判定条件(答案=成立概率) */
  criteria: string;
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion;

export interface JevDecisionAnswer {
  /** 决策答案(choice=选中选项;probe/noul 场景为文本) */
  answer: string;
  /** 置信 0-1(低置信回落由调用方定阈值) */
  confidence: number | null;
}

export interface DecideResult {
  answers: Record<string, JevDecisionAnswer>;
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
    answers?: Record<string, { answer?: unknown; confidence?: unknown }>;
    usage?: { cost?: unknown };
  } | null;
  if (!json?.answers) throw new JevError("Decisions API 响应缺 answers", res.status);
  const answers: Record<string, JevDecisionAnswer> = {};
  for (const [name, a] of Object.entries(json.answers)) {
    answers[name] = {
      answer: typeof a.answer === "string" ? a.answer : String(a.answer ?? ""),
      confidence: typeof a.confidence === "number" ? a.confidence : null,
    };
  }
  return {
    answers,
    usageCost: typeof json.usage?.cost === "number" ? json.usage.cost : null,
  };
}
