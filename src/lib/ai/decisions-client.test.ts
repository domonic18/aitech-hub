/**
 * System One 决策客户端 wire 单测(M53 批A):请求形状(端点 /v1/systemone、
 * Bearer 认证、model/state 对象/questions 结构)、应答映射(ai-invest 契约:
 * choice/score/noul 判别联合 + usage 三件)、异常面(HTTP 非 2xx 双信封/
 * 响应缺字段 → JevError)。fetch 全 mock,零真网。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { decideQuestions, JevError } from "./decisions-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** ai-invest 契约形态的 200 响应体 */
function okResponse(): Response {
  return {
    ok: true,
    json: async () => ({
      model: "typesafe/jev-1.14",
      answers: {
        sentiment: {
          type: "choice",
          choice: "negative",
          probabilities: { positive: 0.05, negative: 0.9 },
          confidence: 0.91,
        },
        kind: { type: "noul", noul: 0.8 },
      },
      usage: { input_tokens: 1200, output_tokens: 0, cost: 0.0031 },
      id: "req-1",
    }),
  } as unknown as Response;
}

const BASE_INPUT = {
  baseUrl: "https://api.codiv.ai",
  apiKey: "sk-codiv-test",
  model: "openjev-latest",
  state: { signals: "[hot-baidu] 文本A\n[hot-zhihu] 文本B" },
  questions: {
    sentiment: {
      type: "choice" as const,
      criteria: {
        positive: "整体呈正面情绪",
        neutral: "中性陈述为主",
        negative: "负面情绪为主",
        mixed: "正负混杂",
      },
      instructions: "这组用户信号的总体舆情倾向是哪类?",
    },
    kind: {
      type: "choice" as const,
      criteria: { hot: "外部热点话题", pain: "用户痛点/需求" },
      instructions: "这组信号更接近热点话题还是用户痛点?",
    },
  },
};

describe("decideQuestions wire(systemone)", () => {
  it("POST /v1/systemone + Bearer 认证 + model/state/questions 结构;应答映射", async () => {
    const fetchMock = vi.fn(async (url: string | URL | globalThis.Request, init?: RequestInit) =>
      okResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await decideQuestions(BASE_INPUT);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.codiv.ai/v1/systemone");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-codiv-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("openjev-latest");
    expect(body.state.signals).toContain("[hot-baidu]");
    expect(body.questions.sentiment.criteria).toHaveProperty("positive");
    expect(body.questions.kind.criteria).toHaveProperty("hot");

    expect(r.model).toBe("typesafe/jev-1.14");
    expect(r.answers.sentiment).toMatchObject({
      type: "choice",
      choice: "negative",
      confidence: 0.91,
    });
    expect(r.answers.kind).toMatchObject({ type: "noul", noul: 0.8 });
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 0, cost: 0.0031 });
    expect(r.requestId).toBe("req-1");
  });

  it("HTTP 非 2xx → JevError;双错误信封提人话(OpenRouter error.message / detail 校验列表)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 402,
        text: async () => '{"error":{"message":"insufficient credits"}}',
      })),
    );
    await expect(decideQuestions(BASE_INPUT)).rejects.toThrow("insufficient credits");
    await expect(decideQuestions(BASE_INPUT)).rejects.toThrow("402");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        text: async () => '{"detail":[{"loc":["questions"],"msg":"invalid"}]}',
      })),
    );
    await expect(decideQuestions(BASE_INPUT)).rejects.toThrow("校验失败");
  });

  it("响应缺 model/answers/usage → JevError;confidence 非数字归一 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ answers: {} }) })),
    );
    await expect(decideQuestions(BASE_INPUT)).rejects.toThrow("model");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          model: "m",
          answers: { kind: { type: "choice", choice: "hot", confidence: "high" } },
          usage: { input_tokens: 1, output_tokens: 0 },
        }),
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
