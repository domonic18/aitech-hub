/**
 * embedding 客户端单测:请求形状(URL/Bearer/体)、维度校验、条数校验、
 * 非 openai 协议拒绝、空批短路、超时/HTTP 错误 kind 归因;
 * fetch 经 vi.stubGlobal 注入(llm-client.test.ts 同手法)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiClientError } from "./errors";
import { EMBED_BATCH_SIZE, embedTexts, parseEmbedResponse } from "./embedding-client";

function stubFetch(responses: Array<{ status: number; body: string }>): void {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)]!;
      i += 1;
      return new Response(r.body, { status: r.status });
    }),
  );
}

const base = {
  protocol: "openai",
  baseUrl: "https://open.bigmodel.test/api/paas/v4",
  modelId: "embedding-3",
  apiKey: "zhipu-key",
  timeoutSec: 30,
  dims: 1024,
};

const vec = (n: number): number[] => Array.from({ length: n }, (_, i) => (i % 7) * 0.1);

const okBody = (count: number, dims: number): string =>
  JSON.stringify({
    data: Array.from({ length: count }, (_, i) => ({ index: i, embedding: vec(dims) })),
    usage: { prompt_tokens: 12 },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("embedTexts 请求形状", () => {
  it("POST {base}/embeddings,Bearer 头,model/input/dimensions 体", async () => {
    const spy = vi.fn(
      async () => new Response(okBody(2, 1024), { status: 200 }),
    ) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", spy);
    const out = await embedTexts({ ...base, texts: ["内容一", "内容二"] });
    expect(out.vectors).toHaveLength(2);
    expect(out.usage.tokensIn).toBe(12);
    expect(out.usage.tokensOut).toBe(0);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://open.bigmodel.test/api/paas/v4/embeddings");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer zhipu-key");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      input: string[];
      dimensions: number;
    };
    expect(body).toEqual({ model: "embedding-3", input: ["内容一", "内容二"], dimensions: 1024 });
  });

  it("空批短路不请求;超上限拒绝", async () => {
    const out = await embedTexts({ ...base, texts: [] });
    expect(out.vectors).toEqual([]);
    await expect(
      embedTexts({ ...base, texts: Array.from({ length: EMBED_BATCH_SIZE + 1 }, () => "x") }),
    ).rejects.toMatchObject({ kind: "unsupported" });
  });

  it("非 openai 协议 / 缺 baseUrl → unsupported", async () => {
    await expect(
      embedTexts({ ...base, protocol: "anthropic", texts: ["x"] }),
    ).rejects.toMatchObject({ kind: "unsupported" });
    await expect(embedTexts({ ...base, baseUrl: null, texts: ["x"] })).rejects.toMatchObject({
      kind: "unsupported",
    });
  });
});

describe("embedTexts 错误归因", () => {
  it("HTTP 401 → http,响应体摘要入错", async () => {
    stubFetch([{ status: 401, body: '{"error":"invalid api key"}' }]);
    await expect(embedTexts({ ...base, texts: ["x"] })).rejects.toMatchObject({
      kind: "http",
      message: expect.stringContaining("HTTP 401"),
    });
  });

  it("fetch 抛 TimeoutError → timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const e = new Error("The operation was aborted due to timeout");
        e.name = "TimeoutError";
        throw e;
      }),
    );
    await expect(embedTexts({ ...base, texts: ["x"] })).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("parseEmbedResponse 契约漂移", () => {
  it("非 JSON / 条数不符 / 维度不符 / 非有限数值 → business", () => {
    expect(() => parseEmbedResponse("not-json", 1, 1024)).toThrow(AiClientError);
    expect(() => parseEmbedResponse(okBody(2, 1024), 1, 1024)).toThrow(/条数不符/);
    expect(() => parseEmbedResponse(okBody(1, 512), 1, 1024)).toThrow(/维度/);
    const badVec = JSON.stringify({
      data: [{ embedding: vec(1023).concat(Number.NaN) }],
      usage: {},
    });
    expect(() => parseEmbedResponse(badVec, 1, 1024)).toThrow(/维度/);
  });
});
