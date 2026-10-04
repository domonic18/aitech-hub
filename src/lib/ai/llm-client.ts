/**
 * LLM chat 客户端(M9 批②):openai/anthropic 双协议 JSON 任务调用,
 * 请求头与探针 probeLlm 同源(Bearer / x-api-key + anthropic-version)。
 * openai 强制 response_format json_object;网关 400 抱怨该字段时剥掉重发一次
 * (兼容仅透传 chat 的中转网关)。返回 assistant 原文,JSON 提炼在 interpret-result。
 */
import { AI_PROTOCOL_ANTHROPIC, AI_PROTOCOL_OPENAI } from "./constants";
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
    `HTTP ${status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`,
  );
}

/** 从 openai choices / anthropic content 提取 assistant 原文(缺失=契约漂移) */
function extractAssistantText(protocol: string, bodyText: string): string {
  let body: unknown = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new AiClientError("business", "2xx 响应非 JSON(契约漂移)");
  }
  if (protocol === AI_PROTOCOL_ANTHROPIC) {
    const content = (body as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) {
      throw new AiClientError("business", "响应缺 content 数组(契约漂移)");
    }
    const text = content
      .filter(
        (b): b is { type: "text"; text: string } =>
          typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text",
      )
      .map((b) => b.text)
      .join("");
    if (!text) throw new AiClientError("business", "响应无 text 块(契约漂移)");
    return text;
  }
  const text = (body as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text) {
    throw new AiClientError("business", "响应缺 assistant 文本(契约漂移)");
  }
  return text;
}

export async function chatJson(input: ChatJsonInput): Promise<string> {
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
    return extractAssistantText(AI_PROTOCOL_ANTHROPIC, reply.text);
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
  return extractAssistantText(AI_PROTOCOL_OPENAI, reply.text);
}
