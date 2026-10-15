/**
 * LLM 流式 chat(K2 答案卡,arch/04 §3.4;技术债批⑤ 自 llm-client 拆出):
 * 双协议均走 SSE——openai(stream:true + include_usage;网关 400 点名
 * stream_options 时剥掉重发一次,镜像 response_format 先例)与 anthropic
 * (标准 content_block_delta 逐 delta,message_start/message_delta 聚合 usage;
 * 400 点名 stream 参数回落非流式整段单 delta,同款先例——流式参数被透传网关
 * 拒绝时保可用性)。text 为空 = 契约漂移。SSE 解析器为纯函数单测锚点。
 */
import { AI_PROTOCOL_ANTHROPIC, AI_PROTOCOL_OPENAI } from "./constants";
import { AiClientError } from "./errors";
import {
  DEFAULT_MAX_TOKENS,
  extractReply,
  httpError,
  parseChatUsage,
  type ChatUsage,
} from "./llm-client";

export interface ChatStreamInput {
  protocol: string;
  baseUrl: string | null;
  modelId: string;
  apiKey: string | null;
  system: string;
  user: string;
  timeoutSec: number;
  maxTokens?: number;
  /** 外部中止(客户端断开);与超时 AbortSignal.any 组合(双协议流式均透传) */
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

/** anthropic SSE 流缓冲解析(纯函数,单测锚点):事件语义全在 data JSON 的 type 字段
 * ——content_block_delta(text_delta)出 deltas;usage 两段式:message_start 带
 * input_tokens、message_delta 带累计 output_tokens,按 max 合并(累计值序健壮);
 * message_stop 即 done。CRLF 容忍,ping/非 JSON 帧跳过 */
export function parseAnthropicSseBuffer(buffer: string): OpenAiSseParsed {
  const norm = buffer.replace(/\r\n/g, "\n");
  const parts = norm.split("\n\n");
  const rest = parts.pop() ?? "";
  const deltas: string[] = [];
  let usage: ChatUsage | null = null;
  let done = false;
  for (const block of parts) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      let body: unknown;
      try {
        body = JSON.parse(line.slice(5).trim());
      } catch {
        continue; // 心跳/注释等非 JSON 帧跳过
      }
      const b = body as {
        type?: string;
        delta?: { text?: unknown; usage?: unknown };
        message?: { usage?: unknown };
        usage?: unknown;
      };
      if (b?.type === "content_block_delta") {
        const d = b.delta?.text;
        if (typeof d === "string" && d !== "") deltas.push(d);
      } else if (b?.type === "message_start" || b?.type === "message_delta") {
        // usage 位置:message_start 在 message.usage;message_delta 现行规范在顶层
        // (2023-06-01),旧形 delta.usage 一并兼容
        const u = b.type === "message_start" ? b.message?.usage : (b.usage ?? b.delta?.usage);
        if (u) {
          const next = parseChatUsage(u);
          usage =
            usage === null
              ? next
              : {
                  tokensIn: Math.max(usage.tokensIn, next.tokensIn),
                  tokensOut: Math.max(usage.tokensOut, next.tokensOut),
                };
        }
      } else if (b?.type === "message_stop") {
        done = true;
      }
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

/** SSE 流读取共享循环(双协议复用):逐块 decode → 协议解析器出 delta/usage/done;
 * usage 按 max 合并(anthropic 两段式累计值序健壮,openai 单帧不受影响)。
 * text 为空 = 契约漂移 */
async function readSse(
  res: Response,
  parse: (buffer: string) => OpenAiSseParsed,
  onDelta: (text: string) => void,
  timeoutSec: number,
): Promise<{ text: string; usage: ChatUsage }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const usage: ChatUsage = { tokensIn: 0, tokensOut: 0 };
  const read = async (): Promise<void> => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parse(buffer);
      buffer = parsed.rest;
      if (parsed.usage) {
        usage.tokensIn = Math.max(usage.tokensIn, parsed.usage.tokensIn);
        usage.tokensOut = Math.max(usage.tokensOut, parsed.usage.tokensOut);
      }
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
      throw new AiClientError("timeout", `LLM 超时 ${timeoutSec}s`);
    }
    throw new AiClientError("http", err instanceof Error ? err.message : String(err));
  }
  if (text === "") throw new AiClientError("business", "流式响应无内容(契约漂移)");
  return { text, usage };
}

/**
 * 流式 chat(K2 答案卡):双协议请求/回落语义见文件头。
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
    const url = `${input.baseUrl}/v1/messages`;
    const headers = { "x-api-key": input.apiKey ?? "", "anthropic-version": "2023-06-01" };
    const payload = {
      model: input.modelId,
      max_tokens: maxTokens,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    };
    let res = await openStream(
      url,
      headers,
      JSON.stringify({ ...payload, stream: true }),
      input.timeoutSec,
      timeout,
    );
    // 400 且错误体点名 stream → 网关不支持流式参数,回落非流式整段单 delta
    if (res.status === 400) {
      const errText = await res.text().catch(() => "");
      if (!errText.includes("stream")) throw httpError(400, errText);
      res = await openStream(url, headers, JSON.stringify(payload), input.timeoutSec, timeout);
      if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""));
      const r = extractReply(AI_PROTOCOL_ANTHROPIC, await res.text());
      onDelta(r.text);
      return { text: r.text, usage: r.usage };
    }
    if (!res.ok) throw httpError(res.status, await res.text().catch(() => ""));
    if (!res.body) throw new AiClientError("http", "流式响应无 body");
    return readSse(res, parseAnthropicSseBuffer, onDelta, input.timeoutSec);
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
  return readSse(res, parseOpenAiSseBuffer, onDelta, input.timeoutSec);
}
