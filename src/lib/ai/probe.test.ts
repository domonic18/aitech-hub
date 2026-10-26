/**
 * 探针单测:WAV 样例形态、openai/anthropic 请求形状(URL/头/体)、
 * 无 key 不带 Authorization、HTTP 错误归因截断、minimax 业务错包装、
 * other 协议诚实 skipped;probeModel 用途分流(2026-10-16 反馈问题3:cover→
 * /images/generations 真实最小生成、embedding→/embeddings 维度校验、文本→chat,
 * 全过才 ok;fetch 经 vi.stubGlobal 注入(先例 rss.test.ts)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({ env: { AUTH_SECRET: "unit-test-auth-secret-0123456789" } }));

import { buildSineWav, probeAsr, probeLlm, probeModel } from "./probe";
import { COVER_IMAGE_SIZE } from "./cover-prompt";

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

describe("probeModel(用途感知分流)", () => {
  const base = {
    modelId: "m",
    apiKey: "sk-t",
    protocol: "openai",
    baseUrl: "https://api.x.com/v1",
  };

  it("绑 cover:真实打 /images/generations(n=1/1344x768/b64_json),2xx 且 data[0] 有图即通", async () => {
    const calls = stubFetch(200, JSON.stringify({ data: [{ b64_json: "AAAA" }] }));
    const r = await probeModel({ ...base, purposes: ["cover"] });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("生图连通");
    expect(calls[0].url).toBe("https://api.x.com/v1/images/generations");
    const body = JSON.parse(String(calls[0].init.body)) as {
      n: number;
      size: string;
      prompt: string;
    };
    expect(body.n).toBe(1);
    expect(body.size).toBe(COVER_IMAGE_SIZE); // 与真实管线同尺寸(不再写死 1024x1024)
    expect(body.prompt.length).toBeGreaterThan(0);
  });

  it("绑 illustrate 同走生图探针;AiHubMix output[]/content_url 形态即通(M39)", async () => {
    const calls = stubFetch(
      200,
      JSON.stringify({ output: [{ index: 0, content_url: "https://api.x.com/file/a.png" }] }),
    );
    const r = await probeModel({ ...base, purposes: ["illustrate"] });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("生图连通");
    expect(calls[0].url).toBe("https://api.x.com/v1/images/generations");
  });

  it("生图 HTTP 200 携 error 且无图:失败透传供应商文案(M39)", async () => {
    stubFetch(200, JSON.stringify({ status: "failed", output: [], error: "quota exceeded" }));
    const r = await probeModel({ ...base, purposes: ["cover"] });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("quota exceeded");
  });

  it("生图非 2xx JSON 错误体:提取 error.message 人话,不带 code/tid 噪音(M39 实测 async_not_enabled 形态)", async () => {
    stubFetch(
      403,
      JSON.stringify({
        error: {
          code: "async_not_enabled",
          message: "Asynchronous tasks are not enabled. Please go to console to activate.",
          tid: "2026102101121856975219003654011",
        },
      }),
    );
    const r = await probeModel({ ...base, purposes: ["illustrate"] });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("HTTP 403");
    expect(r.detail).toContain("Asynchronous tasks are not enabled");
    expect(r.detail).not.toContain("async_not_enabled");
    expect(r.detail).not.toContain("tid");
  });

  it("生图探针带台账 extraParams 浅合并,保留键不可被覆盖(与 image-client 同纪律)", async () => {
    const calls = stubFetch(200, JSON.stringify({ data: [{ url: "https://cdn.x.com/a.jpg" }] }));
    const r = await probeModel({
      ...base,
      purposes: ["cover"],
      timeoutSec: 90,
      extraParams: { watermark_enabled: false, size: "999x999", n: 9, response_format: "url" },
    });
    expect(r.ok).toBe(true);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.watermark_enabled).toBe(false); // 扩展参数透传
    expect(body.size).toBe(COVER_IMAGE_SIZE); // 保留键恒覆盖扩展参数
    expect(body.n).toBe(1);
    expect(body.response_format).toBe("b64_json");
  });

  it("生图探针 extraParams 保留键显式 null = 剔除(与管线同源构造,M39 AiHubMix 实证)", async () => {
    const calls = stubFetch(
      200,
      JSON.stringify({ output: [{ content_url: "https://api.x.com/a.png" }] }),
    );
    const r = await probeModel({
      ...base,
      purposes: ["illustrate"],
      extraParams: { size: null, response_format: null },
    });
    expect(r.ok).toBe(true);
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body.size).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(body.n).toBe(1);
    expect(body.model).toBe("m");
  });

  it("生图 url 形态须 https 且长度合规(与 image-client 转存口径一致)", async () => {
    stubFetch(200, JSON.stringify({ data: [{ url: "http:// insecure.example/a.jpg" }] }));
    const r = await probeModel({ ...base, purposes: ["cover"] });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("契约漂移");
  });

  it("生图响应缺 data 图片数据 → 契约漂移明确失败(非 2xx 误报)", async () => {
    stubFetch(200, JSON.stringify({ data: [] }));
    const r = await probeModel({ ...base, purposes: ["cover"] });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("契约漂移");
  });

  it("anthropic + cover → 生图协议门禁失败(与生图管线同门禁)", async () => {
    stubFetch(200, "{}");
    const r = await probeModel({ ...base, protocol: "anthropic", purposes: ["cover"] });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("生图协议不支持");
  });

  it("绑 embedding:POST /embeddings 校验向量字段,detail 报维度", async () => {
    const calls = stubFetch(200, JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    const r = await probeModel({ ...base, purposes: ["embedding"] });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("(3 维)");
    expect(calls[0].url).toBe("https://api.x.com/v1/embeddings");
    const body = JSON.parse(String(calls[0].init.body)) as { input: string[] };
    expect(body.input).toEqual(["ping"]);
  });

  it("embedding 2xx 缺向量字段 → 失败(aitech-hub 旧探针误报重灾区)", async () => {
    stubFetch(200, JSON.stringify({ data: [{ embedding: null }] }));
    const r = await probeModel({ ...base, purposes: ["embedding"] });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("缺少向量字段");
  });

  it("文本类用途(interpret)仍走 chat;未绑用途回退 chat", async () => {
    const a = stubFetch(200, "{}");
    const r1 = await probeModel({ ...base, purposes: ["interpret"] });
    expect(r1.ok).toBe(true);
    expect(a[0].url).toContain("/chat/completions");
    const b = stubFetch(200, "{}");
    const r2 = await probeModel({ ...base });
    expect(r2.ok).toBe(true);
    expect(b[0].url).toContain("/chat/completions");
  });

  it("多用途混合:逐端点全跑,全过 ok 汇总;任一失败 ok:false 失败带种类前缀", async () => {
    // 第一遍:chat 与 embedding 都通
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        return new Response(
          u.endsWith("/embeddings") ? JSON.stringify({ data: [{ embedding: [1, 2] }] }) : "{}",
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const r1 = await probeModel({ ...base, purposes: ["interpret", "embedding"] });
    expect(r1.ok).toBe(true);
    expect(r1.detail).toContain("向量连通");
    // 第二遍:embedding 端点 500 → 整体失败,detail 归因到种类
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) =>
        String(url).endsWith("/embeddings")
          ? new Response("boom", { status: 500 })
          : new Response("{}", { status: 200 }),
      ),
    );
    const r2 = await probeModel({ ...base, purposes: ["interpret", "embedding"] });
    expect(r2.ok).toBe(false);
    expect(r2.detail).toContain("embeddings");
    expect(r2.detail).toContain("HTTP 500");
  });

  it("other 协议 skipped / 无 baseUrl 明确失败(与旧语义一致)", async () => {
    stubFetch(200, "{}");
    const skipped = await probeModel({ ...base, protocol: "other" });
    expect(skipped.skipped).toBe(true);
    const noBase = await probeModel({ ...base, baseUrl: null });
    expect(noBase.detail).toContain("Base URL 未配置");
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
