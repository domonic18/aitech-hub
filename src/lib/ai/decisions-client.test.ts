/**
 * System One 决策客户端 wire 单测(M53 批A):请求形状(端点/认证/model/
 * state/questions)、应答映射(答案/置信/成本)、异常面(HTTP 非 2xx/响应缺
 * answers → JevError)。fetch 全 mock,零真网。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { decideQuestions, JevError } from "./decisions-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(): Response {
  return {
    ok: true,
    json: async () => ({
      answers: {
        sentiment: { answer: "negative", confidence: 0.91 },
        kind: { answer: "hot", confidence: 0.8 },
      },
      usage: { cost: 0.0031 },
    }),
  } as unknown as Response;
}

const BASE_INPUT = {
  baseUrl: "https://openrouter.ai/api",
  apiKey: "sk-or-test",
  model: "typesafe/jev-1.14",
  state: ["[hot-baidu] 文本A", "[hot-zhihu] 文本B"],
  questions: {
    sentiment: { type: "choice" as const, options: ["positive", "neutral", "negative", "mixed"] },
    kind: { type: "choice" as const, options: ["hot", "pain"] },
  },
};

describe("decideQuestions wire", () => {
  it("POST decisions 端点 + Bearer 认证 + model/state/questions 结构;应答映射与成本", async () => {
    const fetchMock = vi.fn(async (url: string | URL | globalThis.Request, init?: RequestInit) =>
      okResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await decideQuestions(BASE_INPUT);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-or-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("typesafe/jev-1.14");
    expect(body.state).toHaveLength(2);
    expect(body.questions.sentiment.options).toHaveLength(4);
    expect(body.questions.kind.options).toEqual(["hot", "pain"]);

    expect(r.answers.sentiment).toEqual({ answer: "negative", confidence: 0.91 });
    expect(r.answers.kind).toEqual({ answer: "hot", confidence: 0.8 });
    expect(r.usageCost).toBeCloseTo(0.0031);
  });

  it("HTTP 非 2xx → JevError(带状态码与人话截断)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        text: async () => '{"error":{"message":"insufficient credits"}}',
      })),
    );
    await expect(decideQuestions(BASE_INPUT)).rejects.toThrow(JevError);
    await expect(decideQuestions(BASE_INPUT)).rejects.toThrow("402");
  });

  it("响应缺 answers → JevError;confidence 非数字归一 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    await expect(decideQuestions(BASE_INPUT)).rejects.toThrow(JevError);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ answers: { kind: { answer: "hot", confidence: "high" } } }),
      })),
    );
    const r = await decideQuestions(BASE_INPUT);
    expect(r.answers.kind.confidence).toBeNull();
  });

  it("网络异常 → JevError 上抛(调用方降级,客户端不吞)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    await expect(decideQuestions(BASE_INPUT)).rejects.toThrow("connect ECONNREFUSED");
  });
});
