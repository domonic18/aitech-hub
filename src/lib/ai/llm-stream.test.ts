/** llm-stream 单测(M47 批C 补盲):双协议 SSE 解析纯函数锚点(整帧/半截帧
 * rest 拼接/CRLF 容忍/心跳跳过/usage max 合并)+ chatStream fetch 层
 * (openai stream_options 400 剥参重发、anthropic stream 400 回落非流式、
 * 空文本契约漂移、协议白名单)。llm-client 真跑不 mock。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AI_PROTOCOL_ANTHROPIC, AI_PROTOCOL_OPENAI } from "./constants";
import { AiClientError } from "./errors";
import {
  chatStream,
  parseAnthropicSseBuffer,
  parseOpenAiSseBuffer,
  type ChatStreamInput,
} from "./llm-stream";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** SSE 分块响应(多块入参模拟网络分片,验证缓冲 rest 逻辑) */
function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function baseInput(protocol: string): ChatStreamInput {
  return {
    protocol,
    baseUrl: "https://api.example.com",
    modelId: "k2.5",
    apiKey: "sk-x",
    system: "s",
    user: "u",
    timeoutSec: 5,
  };
}

describe("parseOpenAiSseBuffer", () => {
  it("整帧:delta 收集/usage 解析/[DONE] 置 done", () => {
    const r = parseOpenAiSseBuffer(
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"好"}}],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n' +
        "data: [DONE]\n\n",
    );
    expect(r).toEqual({
      deltas: ["你", "好"],
      usage: { tokensIn: 11, tokensOut: 7 },
      done: true,
      rest: "",
    });
  });

  it("半截帧留 rest,与下一块拼接后完整出 delta", () => {
    const r1 = parseOpenAiSseBuffer('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"cho');
    expect(r1.deltas).toEqual(["a"]);
    expect(r1.done).toBe(false);
    expect(r1.rest).toBe('data: {"cho');
    const r2 = parseOpenAiSseBuffer(r1.rest + 'ices":[{"delta":{"content":"b"}}]}\n\n');
    expect(r2.deltas).toEqual(["b"]);
    expect(r2.rest).toBe("");
  });

  it("CRLF 容忍;非 JSON 心跳帧与空 content 跳过", () => {
    const r = parseOpenAiSseBuffer(
      'data: {"choices":[{"delta":{"content":"x"}}]}\r\n\r\n' +
        ": ping\n\n" +
        "data: not-json\n\n" +
        'data: {"choices":[{"delta":{"content":""}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":42}}]}\n\n',
    );
    expect(r.deltas).toEqual(["x"]);
    expect(r.done).toBe(false);
  });
});

describe("parseAnthropicSseBuffer", () => {
  const START = 'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n';
  const DELTA =
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}\n\n';
  const END =
    'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\ndata: {"type":"message_stop"}\n\n';

  it("事件语义:delta 出文本,start+delta 两段 usage 合并,stop 置 done", () => {
    const r = parseAnthropicSseBuffer(START + DELTA + END);
    expect(r.deltas).toEqual(["你"]);
    expect(r.usage).toEqual({ tokensIn: 10, tokensOut: 5 });
    expect(r.done).toBe(true);
    expect(r.rest).toBe("");
  });

  it("usage 累计值乱序到达仍按 max 合并(delta 段先到)", () => {
    const r = parseAnthropicSseBuffer(END + DELTA + START);
    expect(r.usage).toEqual({ tokensIn: 10, tokensOut: 5 });
  });

  it("CRLF 容忍;旧形 delta.usage 兼容;ping/非 JSON 跳过", () => {
    const r = parseAnthropicSseBuffer(
      'data: {"type":"message_delta","delta":{"usage":{"output_tokens":9}}}\r\n\r\n' +
        'data: {"type":"ping"}\n\ndata: ???\n\n',
    );
    expect(r.usage).toEqual({ tokensIn: 0, tokensOut: 9 });
    expect(r.done).toBe(false);
    expect(r.deltas).toEqual([]);
  });

  it("半截事件帧留 rest", () => {
    const r1 = parseAnthropicSseBuffer(DELTA + 'data: {"type":"message_st');
    expect(r1.deltas).toEqual(["你"]);
    expect(r1.rest).toBe('data: {"type":"message_st');
    const r2 = parseAnthropicSseBuffer(r1.rest + 'op"}\n\n');
    expect(r2.done).toBe(true);
  });
});

describe("chatStream 协议白名单", () => {
  it("未知协议 → unsupported", async () => {
    await expect(chatStream(baseInput("grpc"), () => {})).rejects.toMatchObject({
      kind: "unsupported",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("baseUrl 缺失 → unsupported", async () => {
    await expect(
      chatStream({ ...baseInput(AI_PROTOCOL_OPENAI), baseUrl: null }, () => {}),
    ).rejects.toBeInstanceOf(AiClientError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("chatStream openai", () => {
  it("流式 happy path:逐 delta 回调/usage 聚合/请求带 stream_options", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const deltas: string[] = [];
    const r = await chatStream(baseInput(AI_PROTOCOL_OPENAI), (d) => deltas.push(d));
    expect(deltas).toEqual(["你", "好"]);
    expect(r).toEqual({ text: "你好", usage: { tokensIn: 11, tokensOut: 7 } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/chat/completions");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.stream).toBe(true);
  });

  it("400 点名 stream_options → 剥参重发一次", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "stream_options is not supported" } }, 400),
      )
      .mockResolvedValueOnce(
        sseResponse(['data: {"choices":[{"delta":{"content":"回"}}]}\n\ndata: [DONE]\n\n']),
      );
    const r = await chatStream(baseInput(AI_PROTOCOL_OPENAI), () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body2 = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body2.stream_options).toBeUndefined();
    expect(body2.stream).toBe(true);
    expect(r.text).toBe("回");
  });

  it("400 未点名 stream_options → 原样抛 http 错误", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "bad key" } }, 400));
    await expect(chatStream(baseInput(AI_PROTOCOL_OPENAI), () => {})).rejects.toMatchObject({
      kind: "http",
      message: expect.stringContaining("HTTP 400"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("2xx 但无文本 → business 契约漂移", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(["data: [DONE]\n\n"]));
    await expect(chatStream(baseInput(AI_PROTOCOL_OPENAI), () => {})).rejects.toMatchObject({
      kind: "business",
      message: expect.stringContaining("契约漂移"),
    });
  });
});

describe("chatStream anthropic", () => {
  it("流式 happy path:分片跨越事件边界,usage 两段合并,x-api-key 头", async () => {
    // 故意把 content_block_delta 事件拦腰切成两块,验证 readSse 缓冲拼接
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\ndata: {"type":"content_bl',
        'ock_delta","delta":{"type":"text_delta","text":"你"}}\n\n',
        'data: {"type":"message_delta","usage":{"output_tokens":5}}\n\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    const deltas: string[] = [];
    const r = await chatStream(baseInput(AI_PROTOCOL_ANTHROPIC), (d) => deltas.push(d));
    expect(deltas).toEqual(["你"]);
    expect(r).toEqual({ text: "你", usage: { tokensIn: 10, tokensOut: 5 } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-x");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("400 点名 stream → 回落非流式整段单 delta(extractReply 出参)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { message: "stream is not supported" } }, 400))
      .mockResolvedValueOnce(
        jsonResponse({
          content: [{ type: "text", text: "整段回复" }],
          usage: { input_tokens: 3, output_tokens: 4 },
        }),
      );
    const deltas: string[] = [];
    const r = await chatStream(baseInput(AI_PROTOCOL_ANTHROPIC), (d) => deltas.push(d));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body2 = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body2.stream).toBeUndefined(); // 回落不带 stream
    expect(deltas).toEqual(["整段回复"]);
    expect(r).toEqual({ text: "整段回复", usage: { tokensIn: 3, tokensOut: 4 } });
  });

  it("400 未点名 stream → 原样抛错,不回落", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "overloaded" } }, 400));
    await expect(chatStream(baseInput(AI_PROTOCOL_ANTHROPIC), () => {})).rejects.toMatchObject({
      kind: "http",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("outputConfig 透传为 output_config", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}\n\n',
      ]),
    );
    await chatStream(
      { ...baseInput(AI_PROTOCOL_ANTHROPIC), outputConfig: { effort: "high" } },
      () => {},
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.output_config).toEqual({ effort: "high" });
  });
});
