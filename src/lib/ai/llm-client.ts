/**
 * LLM chat 客户端(M9 批②):openai/anthropic 双协议 JSON 任务调用,
 * 请求头与探针 probeLlm 同源(Bearer / x-api-key + anthropic-version)。
 * openai 强制 response_format json_object;网关 400 抱怨该字段时剥掉重发一次
 * (兼容仅透传 chat 的中转网关)。返回 assistant 原文,JSON 提炼在 interpret-result。
 */
import { AI_ERR_DETAIL_MAX, AI_PROTOCOL_ANTHROPIC, AI_PROTOCOL_OPENAI } from "./constants";
import { AiClientError } from "./errors";

export interface ChatJsonInput {
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  system: string;
  user: string;
  timeoutSec: number;
  /** 输出预算(默认 2000:summary ≤1000 字 + points 富余) */
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 2000;

interface RawReply {
  status: number;
  text: string;
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutSec: number,
): Promise<RawReply> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(timeoutSec * 1000),
    });
    return { status: res.status, text: await res.text().catch(() => "") };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new AiClientError("timeout", `LLM 超时 ${timeoutSec}s`);
    }
    throw new AiClientError("http", err instanceof Error ? err.message : String(err));
  }
}

function httpError(status: number, bodyText: string): AiClientError {
  return new AiClientError(
    "http",
    `HTTP ${status}${bodyText ? `: ${bodyText.slice(0, AI_ERR_DETAIL_MAX)}` : ""}`,
  );
}

/** usage 回读(批⑦ 用量台账):openai prompt/completion_tokens 与 anthropic
 * input/output_tokens 归一;网关缺 usage 字段按 0(观测数据不做契约漂移判死) */
export interface ChatUsage {
  tokensIn: number;
  tokensOut: number;
}

function intOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/** usage 归一(openai prompt/completion 与 anthropic input/output 双口径;缺失按 0) */
export function parseChatUsage(u: unknown): ChatUsage {
  const o = (u ?? {}) as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
  return {
    tokensIn: intOr0(o.prompt_tokens ?? o.input_tokens),
    tokensOut: intOr0(o.completion_tokens ?? o.output_tokens),
  };
}

/** 从 openai choices / anthropic content 提取 assistant 原文 + usage(缺失文本=契约漂移) */
function extractReply(protocol: string, bodyText: string): { text: string; usage: ChatUsage } {
  let body: unknown = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new AiClientError("business", "2xx 响应非 JSON(契约漂移)");
  }
  const usageOf = (u: unknown): ChatUsage => parseChatUsage(u);
  if (protocol === AI_PROTOCOL_ANTHROPIC) {
    const b = body as { content?: unknown; usage?: unknown } | null;
    if (!Array.isArray(b?.content)) {
      throw new AiClientError("business", "响应缺 content 数组(契约漂移)");
    }
    const text = b.content
      .filter(
        (blk): blk is { type: "text"; text: string } =>
          typeof blk === "object" && blk !== null && (blk as { type?: unknown }).type === "text",
      )
      .map((blk) => blk.text)
      .join("");
    if (!text) throw new AiClientError("business", "响应无 text 块(契约漂移)");
    return { text, usage: usageOf(b.usage) };
  }
  const b = body as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: unknown;
  } | null;
  const text = b?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text) {
    throw new AiClientError("business", "响应缺 assistant 文本(契约漂移)");
  }
  return { text, usage: usageOf(b.usage) };
}

export async function chatJson(
  input: ChatJsonInput,
  /** 批⑦ 用量台账:成功响应的 usage 回调(重试场景每次成功都回调,消费方自行取舍) */
  onUsage?: (u: ChatUsage) => void,
): Promise<string> {
  if (input.protocol !== AI_PROTOCOL_OPENAI && input.protocol !== AI_PROTOCOL_ANTHROPIC) {
    throw new AiClientError("unsupported", `LLM 协议不支持(${input.protocol})`);
  }
  if (!input.baseUrl) throw new AiClientError("unsupported", "LLM Base URL 未配置");
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (input.protocol === AI_PROTOCOL_ANTHROPIC) {
    const reply = await post(
      `${input.baseUrl}/v1/messages`,
      { "x-api-key": input.apiKey ?? "", "anthropic-version": "2023-06-01" },
      JSON.stringify({
        model: input.modelId,
        max_tokens: maxTokens,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      }),
      input.timeoutSec,
    );
    if (reply.status < 200 || reply.status >= 300) throw httpError(reply.status, reply.text);
    const r = extractReply(AI_PROTOCOL_ANTHROPIC, reply.text);
    onUsage?.(r.usage);
    return r.text;
  }

  const base = {
    model: input.modelId,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
  };
  const headers: Record<string, string> = input.apiKey
    ? { authorization: `Bearer ${input.apiKey}` }
    : {};
  let reply = await post(
    `${input.baseUrl}/chat/completions`,
    headers,
    JSON.stringify({ ...base, response_format: { type: "json_object" } }),
    input.timeoutSec,
  );
  // 400 且错误体点名 response_format → 网关不支持该参数,剥掉重发一次
  if (reply.status === 400 && reply.text.includes("response_format")) {
    reply = await post(
      `${input.baseUrl}/chat/completions`,
      headers,
      JSON.stringify(base),
      input.timeoutSec,
    );
  }
  if (reply.status < 200 || reply.status >= 300) throw httpError(reply.status, reply.text);
  const r = extractReply(AI_PROTOCOL_OPENAI, reply.text);
  onUsage?.(r.usage);
  return r.text;
}

// ---------- 流式 chat(K2 答案卡,arch/04 §3.4) ----------

export interface ChatStreamInput {
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  system: string;
  user: string;
  timeoutSec: number;
  maxTokens?: number;
  /** 外部中止(客户端断开);与超时AbortSignal.any 组合,anthropic 兜底路径不透传(超时兜底) */
  signal?: AbortSignal;
}

export interface OpenAiSseParsed {
  deltas: string[];
  usage: ChatUsage | null;
  done: boolean;
  /** 半截帧(未遇空行收尾)留到下一块拼接 */
  rest: string;
}

/** openai SSE 流缓冲解析(纯函数,单测锚点):完整块出 deltas/usage/done,CRLF 容忍 */
export function parseOpenAiSseBuffer(buffer: string): OpenAiSseParsed {
  const norm = buffer.replace(/\r\n/g, "\n");
  const parts = norm.split("\n\n");
  const rest = parts.pop() ?? "";
  const deltas: string[] = [];
  let usage: ChatUsage | null = null;
  let done = false;
  for (const block of parts) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        done = true;
        continue;
      }
      let body: unknown;
      try {
        body = JSON.parse(payload);
      } catch {
        continue; // 心跳/注释等非 JSON 帧跳过
      }
      const b = body as { choices?: Array<{ delta?: { content?: unknown } }>; usage?: unknown };
      const d = b?.choices?.[0]?.delta?.content;
      if (typeof d === "string" && d !== "") deltas.push(d);
      if (b?.usage) usage = parseChatUsage(b.usage);
    }
  }
  return { deltas, usage, done, rest };
}

async function openStream(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutSec: number,
  signal: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new AiClientError("timeout", `LLM 超时 ${timeoutSec}s`);
    }
    throw new AiClientError("http", err instanceof Error ? err.message : String(err));
  }
}

/**
 * 流式 chat(K2 答案卡):openai 走 SSE(stream:true + include_usage;网关 400
 * 点名 stream_options 时剥掉重发一次,镜像 response_format 先例),usage 末块
 * 缺失按 0;anthropic 非流式兜底——国产 openai 兼容网关为主路径,anthropic
 * 整段单次 onDelta(单块语义,外部 abort 不透传,超时兜底)。text 为空 = 契约漂移。
 */
export async function chatStream(
  input: ChatStreamInput,
  onDelta: (text: string) => void,
): Promise<{ text: string; usage: ChatUsage }> {
  if (input.protocol !== AI_PROTOCOL_OPENAI && input.protocol !== AI_PROTOCOL_ANTHROPIC) {
    throw new AiClientError("unsupported", `LLM 协议不支持(${input.protocol})`);
  }
  if (!input.baseUrl) throw new AiClientError("unsupported", "LLM Base URL 未配置");
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeout =
    input.signal != null
      ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutSec * 1000)])
      : AbortSignal.timeout(input.timeoutSec * 1000);

  if (input.protocol === AI_PROTOCOL_ANTHROPIC) {
    const reply = await post(
      `${input.baseUrl}/v1/messages`,
      { "x-api-key": input.apiKey ?? "", "anthropic-version": "2023-06-01" },
      JSON.stringify({
        model: input.modelId,
        max_tokens: maxTokens,
        system: input.system,
        messages: [{ role: "user", content: input.user }],
      }),
      input.timeoutSec,
    );
    if (reply.status < 200 || reply.status >= 300) throw httpError(reply.status, reply.text);
    const r = extractReply(AI_PROTOCOL_ANTHROPIC, reply.text);
    onDelta(r.text);
    return { text: r.text, usage: r.usage };
  }

  const base = {
    model: input.modelId,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    stream: true,
  };
  const headers: Record<string, string> = input.apiKey
    ? { authorization: `Bearer ${input.apiKey}` }
    : {};
  const url = `${input.baseUrl}/chat/completions`;
  let res = await openStream(
    url,
    headers,
    JSON.stringify({ ...base, stream_options: { include_usage: true } }),
    input.timeoutSec,
    timeout,
  );
  // 400 且错误体点名 stream_options → 网关不支持该参数,剥掉重发一次
  if (res.status === 400) {
    const errText = await res.text().catch(() => "");
    if (!errText.includes("stream_options")) throw httpError(400, errText);
    res = await openStream(url, headers, JSON.stringify(base), input.timeoutSec, timeout);
  }
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""));
  if (!res.body) throw new AiClientError("http", "流式响应无 body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const usage: ChatUsage = { tokensIn: 0, tokensOut: 0 };
  const read = async (): Promise<void> => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseOpenAiSseBuffer(buffer);
      buffer = parsed.rest;
      if (parsed.usage) Object.assign(usage, parsed.usage);
      for (const d of parsed.deltas) {
        text += d;
        onDelta(d);
      }
      if (parsed.done) return;
    }
  };
  try {
    await read();
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new AiClientError("timeout", `LLM 超时 ${input.timeoutSec}s`);
    }
    throw new AiClientError("http", err instanceof Error ? err.message : String(err));
  }
  if (text === "") throw new AiClientError("business", "流式响应无内容(契约漂移)");
  return { text, usage };
}
