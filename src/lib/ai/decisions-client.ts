/**
 * System One 决策模型客户端(M53 批A;typesafe/jev 等 System One 模型):
 * 输入应用状态(state 对象)+ 类型化问题(questions),输出带概率/置信的类型化
 * 决策。与 llm-client(openai/anthropic chat)并列的第三条调用面——决策模型不产
 * 文本,用于打标批的「判定半场」(舆情倾向/hot·pain 覆判)。
 *
 * wire(对齐 ai-invest SystemOneAdapter 生产实现,厂商无关 D23):
 *   POST {baseUrl}/v1/systemone
 *   body = { model, state: 对象, questions: { 名: {type, instructions, criteria} } }
 *   resp = { model: 实际版本, answers: {名: 判别联合}, usage: {input_tokens,
 *           output_tokens, cost?}, id? }
 *   —— choice 应答 {choice, probabilities, confidence};noul 应答 {noul: p(yes)}
 *      无 confidence(数字本身即信念)
 * 同一 wire 通吃 TypeSafe 直连 / OpenRouter / Codiv(openjev)——openjev 的
 * Codiv 端点不实现 OpenRouter 的 /alpha/decisions(2026-10-28 用户实收 400),
 * /v1/systemone 才是跨厂商可移植面。
 *
 * 错误信封双形状兼容(ai-invest 探针③):OpenRouter {"error":{message,code}};
 * 直连 {"detail":{error_type,message}} / 422 detail 为校验列表。
 */
import { authHeaders } from "./probe-shared";

export interface JevChoiceQuestion {
  type: "choice";
  /** 选项 → 判定指引(2-255 项;官方纪律:传全集并设显式 other 项) */
  criteria: Record<string, string>;
  /** 指令(问题句) */
  instructions: string;
}

export interface JevNoulQuestion {
  type: "noul";
  /** 成立/不成立各自的判定指引(wire 字段名 true/false) */
  criteria: { true: string; false: string };
  /** 指令(问题句) */
  instructions: string;
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion;

/** 判别联合应答(choice/score 带 confidence;noul 无——数字本身即信念) */
export interface JevAnswer {
  type: string;
  /** choice:选中选项 */
  choice?: string;
  /** score:概率加权位置(级间可落) */
  score?: number;
  /** noul:p(yes) */
  noul?: number;
  probabilities?: Record<string, number>;
  /** score 应答的级别图例 */
  legend?: Record<string, string>;
  confidence: number | null;
}

export interface DecideResult {
  /** 实际服务的模型版本(pin 纪律:jev-latest 会漂移,观测以本字段为准) */
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { inputTokens: number; outputTokens: number; cost: number | null };
  requestId: string | null;
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

/** 双形状错误信封提人话:OpenRouter error.message / 直连 detail.{error_type,
 * message} / 422 detail 为校验列表;解析失败回退原文截断(ai-invest 同款) */
function errorMessage(status: number, text: string): string {
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    if (payload && typeof payload === "object") {
      const err = payload.error;
      if (err && typeof err === "object" && "message" in err) {
        return String((err as { message: unknown }).message).slice(0, 300);
      }
      const detail = payload.detail;
      if (detail && typeof detail === "object" && "message" in detail) {
        const d = detail as { error_type?: unknown; message: unknown };
        return `${String(d.error_type ?? "error")}: ${String(d.message).slice(0, 300)}`;
      }
      if (Array.isArray(detail)) return `校验失败: ${JSON.stringify(detail).slice(0, 300)}`;
      if (typeof detail === "string" && detail) return detail.slice(0, 300);
    }
  } catch {
    /* 非 JSON 回退原文 */
  }
  return text.slice(0, 300);
}

/** 决策请求;异常面(网络/超时/HTTP)以 JevError 上抛由调用方降级 */
export async function decideQuestions(input: {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  /** 应用状态对象(只放题面需要的字段——context rot 纪律) */
  state: Record<string, unknown>;
  questions: Record<string, JevQuestion>;
  timeoutMs?: number;
}): Promise<DecideResult> {
  const res = await fetch(`${input.baseUrl}/v1/systemone`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(input.apiKey),
    },
    body: JSON.stringify({
      model: input.model,
      state: input.state,
      questions: Object.fromEntries(
        Object.entries(input.questions).map(([key, q]) => [
          key,
          { type: q.type, instructions: q.instructions, criteria: q.criteria },
        ]),
      ),
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new JevError(`${errorMessage(res.status, text)}(HTTP ${res.status})`, res.status);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") throw new JevError("决策模型响应体不是对象", res.status);
  if (typeof body.model !== "string" || body.model === "")
    throw new JevError("响应缺少 model 字段(版本留痕依赖)", res.status);
  if (body.answers === null || typeof body.answers !== "object")
    throw new JevError("响应缺少 answers 对象", res.status);
  const usageRaw = body.usage;
  if (usageRaw === null || typeof usageRaw !== "object")
    throw new JevError("响应缺少 usage 对象", res.status);
  const usageObj = usageRaw as Record<string, unknown>;
  const answers: Record<string, JevAnswer> = {};
  for (const [name, a] of Object.entries(body.answers as Record<string, Record<string, unknown>>)) {
    answers[name] = {
      type: typeof a.type === "string" ? a.type : "unknown",
      ...(typeof a.choice === "string" ? { choice: a.choice } : {}),
      ...(typeof a.score === "number" ? { score: a.score } : {}),
      ...(typeof a.noul === "number" ? { noul: a.noul } : {}),
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
      ...(a.legend !== null && typeof a.legend === "object"
        ? { legend: a.legend as Record<string, string> }
        : {}),
      confidence: typeof a.confidence === "number" ? a.confidence : null,
    };
  }
  return {
    model: body.model,
    answers,
    usage: {
      inputTokens: typeof usageObj.input_tokens === "number" ? usageObj.input_tokens : 0,
      outputTokens: typeof usageObj.output_tokens === "number" ? usageObj.output_tokens : 0,
      cost: typeof usageObj.cost === "number" ? usageObj.cost : null,
    },
    requestId: typeof body.id === "string" ? body.id : null,
  };
}
