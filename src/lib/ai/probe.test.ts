/**
 * 探针单测:WAV 样例形态、openai/anthropic 请求形状(URL/头/体)、
 * 无 key 不带 Authorization、HTTP 错误归因截断、minimax 业务错包装、
 * other 协议诚实 skipped;fetch 经 vi.stubGlobal 注入(先例 rss.test.ts)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({ env: { AUTH_SECRET: "unit-test-auth-secret-0123456789" } }));

import { buildSineWav, probeAsr, probeLlm } from "./probe";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function stubFetch(status: number, body: string, contentType = "application/json"): CapturedCall[] {
  const calls: CapturedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(body, { status, headers: { "content-type": contentType } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSineWav", () => {
  it("44 字节 RIFF 头 + 32000 采样;fmt=16k/mono/16bit", () => {
    const wav = buildSineWav();
    expect(wav.length).toBe(32044);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(32000);
  });
});

describe("probeLlm", () => {
  const base = { modelId: "deepseek-chat", apiKey: "sk-test-1234" };

  it("openai:POST {base}/chat/completions,Bearer 头,max_tokens=1 ping 体", async () => {
    const calls = stubFetch(200, "{}");
    const r = await probeLlm({ ...base, protocol: "openai", baseUrl: "https://api.x.com/v1" });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/HTTP 200 · \d+ms/);
    expect(calls[0].url).toBe("https://api.x.com/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test-1234");
    const body = JSON.parse(String(calls[0].init.body)) as {
      max_tokens: number;
      messages: unknown[];
    };
    expect(body.max_tokens).toBe(1);
    expect(body.messages).toHaveLength(1);
  });

  it("anthropic:POST {base}/v1/messages,x-api-key + anthropic-version 头", async () => {
    const calls = stubFetch(200, "{}");
    const r = await probeLlm({ ...base, protocol: "anthropic", baseUrl: "https://api.x.com" });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.x.com/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test-1234");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.authorization).toBeUndefined();
  });

  it("无 key 不带 Authorization(内网无鉴权网关)", async () => {
    const calls = stubFetch(200, "{}");
    await probeLlm({
      protocol: "openai",
      baseUrl: "https://intra.x.com",
      modelId: "m",
      apiKey: null,
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("401 → ok:false,detail 截 200 字符含状态码", async () => {
    stubFetch(401, JSON.stringify({ error: { message: "bad key" } }));
    const r = await probeLlm({ ...base, protocol: "openai", baseUrl: "https://api.x.com" });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/^HTTP 401: .{1,200}$/);
    expect(r.detail).toContain("bad key");
  });

  it("Base URL 未配置 → 明确失败;other 协议 → skipped 不发请求", async () => {
    stubFetch(200, "{}");
    const noBase = await probeLlm({ ...base, protocol: "openai", baseUrl: null });
    expect(noBase.detail).toContain("Base URL 未配置");
    const calls = stubFetch(200, "{}");
    const skipped = await probeLlm({ ...base, protocol: "other", baseUrl: "https://x.com" });
    expect(skipped.skipped).toBe(true);
    expect(skipped.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("probeAsr", () => {
  const base = { modelId: "whisper-1", apiKey: "sk-asr" };

  it("openai:multipart POST {base}/audio/transcriptions(file+model)", async () => {
    const calls = stubFetch(200, JSON.stringify({ text: "" }));
    const r = await probeAsr({ ...base, protocol: "openai", baseUrl: "https://asr.x.com/v1" });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("https://asr.x.com/v1/audio/transcriptions");
    const form = calls[0].init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("minimax:2xx 且 base_resp.status_code!=0 → 业务失败读 status_msg", async () => {
    stubFetch(200, JSON.stringify({ base_resp: { status_code: 1004, status_msg: "invalid key" } }));
    const r = await probeAsr({ ...base, protocol: "minimax", baseUrl: "https://asr.x.com" });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("业务错误 1004");
    expect(r.detail).toContain("invalid key");
  });

  it("minimax:2xx 无 base_resp(转写空文本)→ 成功", async () => {
    stubFetch(200, JSON.stringify({ text: "" }));
    const r = await probeAsr({ ...base, protocol: "minimax", baseUrl: "https://asr.x.com" });
    expect(r.ok).toBe(true);
  });

  it("other 协议 → skipped;Base URL 未配置 → 明确失败", async () => {
    stubFetch(200, "{}");
    const skipped = await probeAsr({ ...base, protocol: "other", baseUrl: "https://x.com" });
    expect(skipped.skipped).toBe(true);
    const noBase = await probeAsr({ ...base, protocol: "openai", baseUrl: null });
    expect(noBase.detail).toContain("Base URL 未配置");
  });
});
