/**
 * model-factory 单测:openai → ChatOpenAI(baseURL 透传)、anthropic →
 * ChatAnthropic(anthropicApiUrl 透传)、无绑定/未知协议拒(AgentModelError);
 * 每次现解析(两次调用两次 resolve)。构造器经 vi.mock 捕获 options。
 * extraParams 接线(2026-10-17 max_tokens 根修):max_tokens/output_config
 * 只从台账读,零代码默认;配错型 warn 不静默,openai 侧 output_config 不支持
 * 即 warn 忽略;anthropic 未配 max_tokens 提示截断风险。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiCtor = vi.hoisted(() => vi.fn());
const anthropicCtor = vi.hoisted(() => vi.fn());
const resolveAiModelMock = vi.hoisted(() => vi.fn());
const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@langchain/openai", () => ({ ChatOpenAI: openaiCtor }));
vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: anthropicCtor }));
vi.mock("../ai/resolver", () => ({ resolveAiModel: resolveAiModelMock }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: loggerWarn, error: vi.fn() } }));

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

describe("extraParams 接线(max_tokens/output_config 只住台账)", () => {
  it("anthropic:台账值进构造参数 maxTokens/outputConfig,代码零默认", async () => {
    resolveAiModelMock.mockResolvedValue({
      ...BASE_MODEL,
      protocol: "anthropic",
      extraParams: { max_tokens: 131_072, output_config: { effort: "high" } },
    });
    await resolveAgentModel();
    expect(anthropicCtor).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 131_072, outputConfig: { effort: "high" } }),
    );
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it("anthropic 未配 max_tokens → 不带 maxTokens + 截断风险 warn(langchain 4096 兜底仍在)", async () => {
    resolveAiModelMock.mockResolvedValue({ ...BASE_MODEL, protocol: "anthropic" });
    await resolveAgentModel();
    const opts = anthropicCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.maxTokens).toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.model_max_tokens_unconfigured" }),
    );
  });

  it("max_tokens 配错型 → warn invalid,不带值不静默吞", async () => {
    resolveAiModelMock.mockResolvedValue({
      ...BASE_MODEL,
      protocol: "anthropic",
      extraParams: { max_tokens: "131072" },
    });
    await resolveAgentModel();
    const opts = anthropicCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.maxTokens).toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.model_extra_params_invalid", key: "max_tokens" }),
    );
  });

  it("openai:仅 max_tokens 生效;output_config 不支持 → warn 忽略", async () => {
    resolveAiModelMock.mockResolvedValue({
      ...BASE_MODEL,
      extraParams: { max_tokens: 8192, output_config: { effort: "high" } },
    });
    await resolveAgentModel();
    expect(openaiCtor).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 8192 }));
    const opts = openaiCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(opts.outputConfig).toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.model_extra_params_ignored", key: "output_config" }),
    );
  });
});

describe("temperature 接线(2026-10 Kimi/DeepSeek 切换:零 hardcode)", () => {
  it("未配 temperature → 构造参数不带该字段(不再有 0.3 硬编码)", async () => {
    resolveAiModelMock.mockResolvedValue({ ...BASE_MODEL, protocol: "anthropic" });
    await resolveAgentModel();
    const opts = anthropicCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("temperature" in opts).toBe(false);
    expect(loggerWarn).not.toHaveBeenCalledWith(expect.objectContaining({ key: "temperature" }));
  });

  it("anthropic 台账配 1(thinking 开启时唯一合法显式值)→ 透传", async () => {
    resolveAiModelMock.mockResolvedValue({
      ...BASE_MODEL,
      protocol: "anthropic",
      extraParams: { max_tokens: 65_536, temperature: 1 },
    });
    await resolveAgentModel();
    expect(anthropicCtor).toHaveBeenCalledWith(expect.objectContaining({ temperature: 1 }));
  });

  it("openai 台账配 0.3(等价迁移)→ 透传", async () => {
    resolveAiModelMock.mockResolvedValue({ ...BASE_MODEL, extraParams: { temperature: 0.3 } });
    await resolveAgentModel();
    expect(openaiCtor).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.3 }));
  });

  it("temperature 配错型 → warn invalid,不带值不静默吞", async () => {
    resolveAiModelMock.mockResolvedValue({
      ...BASE_MODEL,
      protocol: "anthropic",
      extraParams: { temperature: 3 },
    });
    await resolveAgentModel();
    const opts = anthropicCtor.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("temperature" in opts).toBe(false);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "agent.model_extra_params_invalid", key: "temperature" }),
    );
  });
});
