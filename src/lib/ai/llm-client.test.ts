/**
 * LLM 客户端单测:双协议 URL/头/体形状、openai response_format 及
 * 400 剥参重发、anthropic content 拼接、错误 kind 归因;
 * fetch 经 vi.stubGlobal 注入(probe.test.ts 同手法)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { chatJson } from "./llm-client";
import { AiClientError } from "./errors";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function stubFetch(responses: Array<{ status: number; body: string }>): CapturedCall[] {
  const calls: CapturedCall[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const r = responses[Math.min(i, responses.length - 1)]!;
      i += 1;
      return new Response(r.body, { status: r.status });
    }),
  );
  return calls;
}

const base = {
  protocol: "openai",
  baseUrl: "https://llm.test/v1",
  modelId: "deepseek-chat",
  apiKey: "sk-llm-1",
  system: "只输出 JSON",
  user: "概括这条视频",
  timeoutSec: 60,
};

const OPENAI_OK = JSON.stringify({
  choices: [{ message: { content: '{"topic":"主题"}' } }],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatJson 请求形状", () => {
  it("openai:POST {base}/chat/completions,Bearer 头,system/user 消息 + json_object", async () => {
    const calls = stubFetch([{ status: 200, body: OPENAI_OK }]);
    const out = await chatJson(base);
    expect(out).toBe('{"topic":"主题"}');
    expect(calls[0]!.url).toBe("https://llm.test/v1/chat/completions");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-llm-1");
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string }>;
      response_format: { type: string };
    };
    expect(body.model).toBe("deepseek-chat");
    expect(body.max_tokens).toBe(2000);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.response_format.type).toBe("json_object");
  });

  it("400 点名 response_format → 剥掉重发一次成功", async () => {
    const calls = stubFetch([
      { status: 400, body: '{"error":{"message":"response_format is not supported"}}' },
      { status: 200, body: OPENAI_OK },
    ]);
    const out = await chatJson(base);
    expect(out).toBe('{"topic":"主题"}');
    expect(calls).toHaveLength(2);
    const retryBody = JSON.parse(String(calls[1]!.init.body)) as {
      response_format?: unknown;
    };
    expect(retryBody.response_format).toBeUndefined();
  });

  it("anthropic:POST {base}/v1/messages,x-api-key 头,system 独立字段,content 块拼接", async () => {
    const calls = stubFetch([
      {
        status: 200,
        body: JSON.stringify({
          content: [
            { type: "text", text: '{"topic":' },
            { type: "text", text: '"主题"}' },
          ],
        }),
      },
    ]);
    const out = await chatJson({
      ...base,
      protocol: "anthropic",
      baseUrl: "https://llm.test",
      maxTokens: 500,
    });
    expect(out).toBe('{"topic":"主题"}');
    expect(calls[0]!.url).toBe("https://llm.test/v1/messages");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-llm-1");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      system: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.system).toBe("只输出 JSON");
    expect(body.max_tokens).toBe(500);
    expect(body.messages).toEqual([{ role: "user", content: "概括这条视频" }]);
  });

  it("无 key:openai 不带 Authorization;anthropic 仍需 x-api-key 占位", async () => {
    let calls = stubFetch([{ status: 200, body: OPENAI_OK }]);
    await chatJson({ ...base, apiKey: null });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();

    calls = stubFetch([
      { status: 200, body: JSON.stringify({ content: [{ type: "text", text: "x" }] }) },
    ]);
    await chatJson({ ...base, protocol: "anthropic", apiKey: null });
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("");
  });
});

describe("chatJson 错误归因", () => {
  it("HTTP 401(未点名 response_format)→ kind=http,不重发", async () => {
    const calls = stubFetch([{ status: 401, body: '{"error":"bad key"}' }]);
    const err = await chatJson(base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe("http");
    expect((err as AiClientError).message).toContain("bad key");
    expect(calls).toHaveLength(1);
  });

  it("2xx 缺 assistant 文本 → kind=business(契约漂移)", async () => {
    stubFetch([{ status: 200, body: '{"choices":[]}' }]);
    const err = await chatJson(base).catch((e: unknown) => e);
    expect((err as AiClientError).kind).toBe("business");
  });

  it("2xx 非 JSON → kind=business", async () => {
    stubFetch([{ status: 200, body: "<html>ok</html>" }]);
    const err = await chatJson(base).catch((e: unknown) => e);
    expect((err as AiClientError).kind).toBe("business");
  });

  it("超时 → kind=timeout;网络失败 → kind=http;other 协议 → unsupported 不触网", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      }),
    );
    const timeoutErr = await chatJson(base).catch((e: unknown) => e);
    expect((timeoutErr as AiClientError).kind).toBe("timeout");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const netErr = await chatJson(base).catch((e: unknown) => e);
    expect((netErr as AiClientError).kind).toBe("http");

    const calls = stubFetch([{ status: 200, body: "{}" }]);
    const protoErr = await chatJson({ ...base, protocol: "other" }).catch((e: unknown) => e);
    expect((protoErr as AiClientError).kind).toBe("unsupported");
    const urlErr = await chatJson({ ...base, baseUrl: null }).catch((e: unknown) => e);
    expect((urlErr as AiClientError).kind).toBe("unsupported");
    expect(calls).toHaveLength(0);
  });
});
