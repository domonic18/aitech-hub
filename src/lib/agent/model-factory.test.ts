/**
 * model-factory 单测:openai → ChatOpenAI(baseURL 透传)、anthropic →
 * ChatAnthropic(anthropicApiUrl 透传)、无绑定/未知协议拒(AgentModelError);
 * 每次现解析(两次调用两次 resolve)。构造器经 vi.mock 捕获 options。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiCtor = vi.hoisted(() => vi.fn());
const anthropicCtor = vi.hoisted(() => vi.fn());
const resolveAiModelMock = vi.hoisted(() => vi.fn());

vi.mock("@langchain/openai", () => ({ ChatOpenAI: openaiCtor }));
vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: anthropicCtor }));
vi.mock("../ai/resolver", () => ({ resolveAiModel: resolveAiModelMock }));

import { AgentModelError, resolveAgentModel } from "./model-factory";

const BASE_MODEL = {
  id: 7,
  name: "主力",
  protocol: "openai",
  baseUrl: "https://gw.example.com/v1",
  modelId: "deepseek-chat",
  apiKey: "sk-x",
  timeoutSec: 60,
  concurrency: 2,
  supportsVision: false,
  extraParams: {},
  source: "primary" as const,
};

beforeEach(() => {
  // 可构造(传统 function):new ChatOpenAI(...) 需要
  openaiCtor.mockReset().mockImplementation(function (this: unknown, o: unknown) {
    return { kind: "openai", o };
  });
  anthropicCtor.mockReset().mockImplementation(function (this: unknown, o: unknown) {
    return { kind: "anthropic", o };
  });
  resolveAiModelMock.mockReset();
});

describe("resolveAgentModel", () => {
  it("openai 协议 → ChatOpenAI,baseURL/apiKey/超时透传,重试归零", async () => {
    resolveAiModelMock.mockResolvedValue(BASE_MODEL);
    const { model, resolved } = await resolveAgentModel();
    expect((model as unknown as { kind: string }).kind).toBe("openai");
    expect(resolved.source).toBe("primary");
    expect(openaiCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-chat",
        apiKey: "sk-x",
        maxRetries: 0,
        timeout: 60_000,
        configuration: { baseURL: "https://gw.example.com/v1" },
      }),
    );
  });

  it("anthropic 协议 → ChatAnthropic,anthropicApiUrl 透传", async () => {
    resolveAiModelMock.mockResolvedValue({
      ...BASE_MODEL,
      protocol: "anthropic",
      baseUrl: "https://hk.example.com",
    });
    const { model } = await resolveAgentModel();
    expect((model as unknown as { kind: string }).kind).toBe("anthropic");
    expect(anthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-chat",
        apiKey: "sk-x",
        anthropicApiUrl: "https://hk.example.com",
      }),
    );
  });

  it("无 baseUrl:openai 不带 configuration,anthropic 不带 anthropicApiUrl", async () => {
    resolveAiModelMock.mockResolvedValue({ ...BASE_MODEL, baseUrl: null });
    await resolveAgentModel();
    expect(openaiCtor).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: { baseURL: undefined } }),
    );
    resolveAiModelMock.mockResolvedValue({ ...BASE_MODEL, protocol: "anthropic", baseUrl: null });
    await resolveAgentModel();
    const opts = anthropicCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.anthropicApiUrl).toBeUndefined();
  });

  it("无绑定 → AgentModelError:no_binding", async () => {
    resolveAiModelMock.mockResolvedValue(null);
    await expect(resolveAgentModel()).rejects.toThrow("no_binding");
  });

  it("未知协议 → AgentModelError:unsupported_protocol(同 llm-client 拒绝口径)", async () => {
    resolveAiModelMock.mockResolvedValue({ ...BASE_MODEL, protocol: "minimax" });
    await expect(resolveAgentModel()).rejects.toBeInstanceOf(AgentModelError);
  });

  it("每次调用现解析(绑定/启停即时生效)", async () => {
    resolveAiModelMock.mockResolvedValue(BASE_MODEL);
    await resolveAgentModel();
    await resolveAgentModel();
    expect(resolveAiModelMock).toHaveBeenCalledTimes(2);
  });
});
