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
 *      无 confidence(数字本身即信念);score 应答 {score: 档位下标, legend}
 *   —— criteria 形状随 type 变:choice=字典(option→指引),noul=字典(true/false),
 *      score=档位数组(按序编号)
 * 同一 wire 通吃 TypeSafe 直连 / OpenRouter / Codiv(openjev)——openjev 的
 * Codiv 端点不实现 OpenRouter 的 /alpha/decisions(2026-10-28 用户实收 400),
 * /v1/systemone 才是跨厂商可移植面。
 *
 * 错误信封双形状兼容(ai-invest 探针③):OpenRouter {"error":{message,code}};
 * 直连 {"detail":{error_type,message}} / 422 detail 为校验列表。
 */
import { DECISION_API_RATE_LIMIT_PER_MIN } from "./constants";
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

/**
 * 打分型:criteria 是**档位数组**(按档位从低到高),服务端按数组序编号 0..n-1。
 * 传字典会被判 422(choice 才是字典)——2026-11-27 生产实测。
 * 应答的 score 是**档位下标**(概率加权位置,级间可落),不是百分制分数,
 * 要换算成数值得自己按档位区间插值。
 */
export interface JevScoreQuestion {
  type: "score";
  criteria: string[];
  instructions: string;
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion | JevScoreQuestion;

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

/**
 * 限速闸:决策端点 60 请求/分钟/key(429 会让整批判分退化成规则兜底)。
 * 按**最小间隔**发请求,而不是只压并发——突发照样撞线。
 * 同一 key 可能被别的用途(探针/洞察打标)共用,留了余量并对 429 再重试一次。
 */
const MIN_INTERVAL_MS = Math.ceil(60_000 / DECISION_API_RATE_LIMIT_PER_MIN) + 60;
let nextSlotAt = 0;

/** 限速闸的可调项(单测里把间隔与重试等待调 0 免等待;生产别改) */
export const decisionRateLimit = { minIntervalMs: MIN_INTERVAL_MS, retryWaitMs: 3_000 };

async function acquireSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + decisionRateLimit.minIntervalMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
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
  const payload = JSON.stringify({
    model: input.model,
    state: input.state,
    questions: Object.fromEntries(
      Object.entries(input.questions).map(([key, q]) => [
        key,
        { type: q.type, instructions: q.instructions, criteria: q.criteria },
      ]),
    ),
  });
  const headers = { "content-type": "application/json", ...authHeaders(input.apiKey) };

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await acquireSlot();
    res = await fetch(`${input.baseUrl}/v1/systemone`, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
    });
    // 429 是限速不是故障:等一拍再试一次,别让调用方整条降级
    if (res.status !== 429 || attempt === 1) break;
    await new Promise((resolve) => setTimeout(resolve, decisionRateLimit.retryWaitMs));
  }
  if (res === null) throw new JevError("决策请求未发出", 0);
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
