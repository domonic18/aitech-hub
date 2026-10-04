/**
 * ASR 客户端单测:URL 拼法/鉴权头/表单字段、hotwords→prompt、
 * minimax 2xx 业务错包装、HTTP/超时/网络/不支持协议的 kind 归因;
 * fetch 经 vi.stubGlobal 注入(probe.test.ts 同手法)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { transcribeAudio } from "./asr-client";
import { AiClientError } from "./errors";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function stubFetch(status: number, body: string): CapturedCall[] {
  const calls: CapturedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(body, { status });
    }),
  );
  return calls;
}

const AUDIO = Buffer.from("fake-mp3-bytes");

function baseInput(over: Partial<Parameters<typeof transcribeAudio>[0]> = {}) {
  return {
    protocol: "openai",
    baseUrl: "https://asr.test/v1",
    modelId: "whisper-1",
    apiKey: "sk-asr-1",
    audio: AUDIO,
    filename: "clip.mp3",
    timeoutSec: 30,
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcribeAudio 请求形状", () => {
  it("openai:POST {base}/audio/transcriptions,Bearer 头,form 带 file/model", async () => {
    const calls = stubFetch(200, JSON.stringify({ text: "你好世界" }));
    const text = await transcribeAudio(baseInput());
    expect(text).toBe("你好世界");
    expect(calls[0]!.url).toBe("https://asr.test/v1/audio/transcriptions");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-asr-1");
    const form = calls[0]!.init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect((form.get("file") as File).name).toBe("clip.mp3");
    expect(form.get("prompt")).toBeNull(); // 未传热词不带 prompt
  });

  it("hotwords → openai form.prompt(逗号连接);minimax 不带 prompt", async () => {
    let calls = stubFetch(200, JSON.stringify({ text: "x" }));
    await transcribeAudio(baseInput({ hotwords: ["大模型", "RAG"] }));
    expect((calls[0]!.init.body as FormData).get("prompt") as string).toBe("大模型,RAG");

    calls = stubFetch(200, JSON.stringify({ text: "x", base_resp: { status_code: 0 } }));
    await transcribeAudio(baseInput({ protocol: "minimax", hotwords: ["大模型"] }));
    const form = calls[0]!.init.body as FormData;
    expect(form.get("prompt")).toBeNull();
  });

  it("minimax:POST {base}/v1/speech_to_text,2xx + base_resp=0 → 取 text", async () => {
    const calls = stubFetch(
      200,
      JSON.stringify({ text: "转写结果", base_resp: { status_code: 0 } }),
    );
    const text = await transcribeAudio(
      baseInput({ protocol: "minimax", baseUrl: "https://asr.test" }),
    );
    expect(text).toBe("转写结果");
    expect(calls[0]!.url).toBe("https://asr.test/v1/speech_to_text");
  });

  it("无 key 不带 Authorization(内网网关)", async () => {
    const calls = stubFetch(200, JSON.stringify({ text: "x" }));
    await transcribeAudio(baseInput({ apiKey: null }));
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });
});

describe("transcribeAudio 错误归因", () => {
  it("minimax 2xx 业务错(base_resp.status_code!=0)→ kind=business", async () => {
    stubFetch(200, JSON.stringify({ base_resp: { status_code: 1039, status_msg: "限流" } }));
    const err = await transcribeAudio(baseInput({ protocol: "minimax" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe("business");
    expect((err as AiClientError).message).toContain("1039");
  });

  it("HTTP 非 2xx → kind=http(错误体截 200 入 detail)", async () => {
    stubFetch(401, JSON.stringify({ error: "bad key" }));
    const err = await transcribeAudio(baseInput()).catch((e: unknown) => e);
    expect((err as AiClientError).kind).toBe("http");
    expect((err as AiClientError).message).toContain("401");
    expect((err as AiClientError).message).toContain("bad key");
  });

  it("2xx 响应缺 text 字段 → kind=business(契约漂移)", async () => {
    stubFetch(200, JSON.stringify({ unexpected: true }));
    const err = await transcribeAudio(baseInput()).catch((e: unknown) => e);
    expect((err as AiClientError).kind).toBe("business");
  });

  it("超时 → kind=timeout;网络失败 → kind=http", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
      }),
    );
    const timeoutErr = await transcribeAudio(baseInput()).catch((e: unknown) => e);
    expect((timeoutErr as AiClientError).kind).toBe("timeout");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const netErr = await transcribeAudio(baseInput()).catch((e: unknown) => e);
    expect((netErr as AiClientError).kind).toBe("http");
  });

  it("协议 other / baseUrl 缺失 → kind=unsupported,不触网", async () => {
    const calls = stubFetch(200, "{}");
    const protoErr = await transcribeAudio(baseInput({ protocol: "other" })).catch(
      (e: unknown) => e,
    );
    expect((protoErr as AiClientError).kind).toBe("unsupported");
    const urlErr = await transcribeAudio(baseInput({ baseUrl: null })).catch((e: unknown) => e);
    expect((urlErr as AiClientError).kind).toBe("unsupported");
    expect(calls).toHaveLength(0);
  });
});
