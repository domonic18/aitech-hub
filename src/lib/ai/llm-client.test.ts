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

// ---------- 流式 chat(K2 答案卡) ----------

import { chatStream, parseOpenAiSseBuffer } from "./llm-client";

function sseFrame(payloads: string[]): string {
  return payloads.map((p) => `data: ${p}\n\n`).join("");
}

/** SSE 流式响应体(分帧 enqueue,验证跨块解析) */
function sseResponse(frames: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f));
        c.close();
      },
    }),
    { status: 200 },
  );
}

describe("parseOpenAiSseBuffer", () => {
  it("多帧出 deltas/usage/DONE,半截帧留 rest", () => {
    const buf =
      sseFrame(['{"choices":[{"delta":{"content":"你"}}]}']) +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: {"usage":{"prompt_tokens":3,"completion_tokens":5}}\n\ndata: {"cho'; // 半截
    const p = parseOpenAiSseBuffer(buf);
    expect(p.deltas).toEqual(["你", "好"]);
    expect(p.usage).toEqual({ tokensIn: 3, tokensOut: 5 });
    expect(p.done).toBe(false);
    expect(p.rest).toBe('data: {"cho');
  });

  it("[DONE] 置 done;CRLF 容忍;非 JSON 帧跳过", () => {
    const p = parseOpenAiSseBuffer(
      "data: [DONE]\r\n\r\n" + "data: :heartbeat\r\n\r\ndata: not-json\r\n\r\n",
    );
    expect(p.done).toBe(true);
    expect(p.deltas).toEqual([]);
    expect(p.usage).toBeNull();
  });
});

describe("chatStream", () => {
  const streamBase = { ...base, maxTokens: 800 };

  it("openai:SSE 逐块 onDelta,usage 透传,请求体含 stream+stream_options", async () => {
    const calls: CapturedCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return sseResponse([
          sseFrame(['{"choices":[{"delta":{"content":"答案"}}]}']),
          'data: {"choices":[{"delta":{"content":"[1]"}}]}\n\n' +
            'data: {"usage":{"prompt_tokens":11,"completion_tokens":22}}\n\ndata: [DONE]\n\n',
        ]);
      }),
    );
    const deltas: string[] = [];
    const r = await chatStream(streamBase, (d) => deltas.push(d));
    expect(deltas.join("")).toBe("答案[1]");
    expect(r.text).toBe("答案[1]");
    expect(r.usage).toEqual({ tokensIn: 11, tokensOut: 22 });
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      stream: boolean;
      stream_options: { include_usage: boolean };
      max_tokens: number;
    };
    expect(body.stream).toBe(true);
    expect(body.stream_options.include_usage).toBe(true);
    expect(body.max_tokens).toBe(800);
  });

  it("400 点名 stream_options → 剥掉重发一次(镜像 response_format 先例)", async () => {
    const calls: CapturedCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) {
          return new Response('{"error":"stream_options is not supported"}', { status: 400 });
        }
        return sseResponse([
          sseFrame(['{"choices":[{"delta":{"content":"ok"}}]}']),
          "data: [DONE]\n\n",
        ]);
      }),
    );
    const r = await chatStream(streamBase, () => undefined);
    expect(r.text).toBe("ok");
    expect(calls).toHaveLength(2);
    // 重发体不再含 stream_options
    expect(String(calls[1]!.init.body)).not.toContain("stream_options");
  });

  it("流体读毕零内容 → business;非 2xx → http", async () => {
    stubFetch([{ status: 200, body: "" }]);
    const noBody = await chatStream(streamBase, () => undefined).catch((e: unknown) => e);
    expect((noBody as AiClientError).kind).toBe("business");

    stubFetch([{ status: 502, body: "bad gateway" }]);
    const httpErr = await chatStream(streamBase, () => undefined).catch((e: unknown) => e);
    expect((httpErr as AiClientError).kind).toBe("http");
  });

  it("anthropic 非流式兜底:整段单次 onDelta + usage", async () => {
    stubFetch([
      {
        status: 200,
        body: JSON.stringify({
          content: [{ type: "text", text: "整段回答" }],
          usage: { input_tokens: 7, output_tokens: 9 },
        }),
      },
    ]);
    const deltas: string[] = [];
    const r = await chatStream({ ...streamBase, protocol: "anthropic" }, (d) => deltas.push(d));
    expect(deltas).toEqual(["整段回答"]);
    expect(r.usage).toEqual({ tokensIn: 7, tokensOut: 9 });
  });
});
