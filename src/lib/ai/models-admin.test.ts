/**
 * models-admin 纯函数单测:normalizeBaseUrl 已知端点尾缀剥离、
 * AiModelCreateSchema 边界(空名/空 purposes/越界并发)。db/env 经 vi.mock 隔离。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../env", () => ({ env: { AUTH_SECRET: "unit-test-auth-secret-0123456789" } }));

import { AiModelCreateSchema, normalizeBaseUrl } from "./models-admin";

describe("normalizeBaseUrl", () => {
  it("剥已知端点尾缀 + 尾斜杠;已裸 base 原样", () => {
    expect(normalizeBaseUrl("https://api.x.com/v1/")).toBe("https://api.x.com/v1");
    expect(normalizeBaseUrl("https://api.x.com/v1/chat/completions")).toBe("https://api.x.com/v1");
    expect(normalizeBaseUrl("https://api.x.com/v1/messages")).toBe("https://api.x.com");
    expect(normalizeBaseUrl("https://asr.x.com/v1/audio/transcriptions")).toBe(
      "https://asr.x.com/v1",
    );
    expect(normalizeBaseUrl("https://asr.x.com/v1/speech_to_text")).toBe("https://asr.x.com");
    expect(normalizeBaseUrl("  https://api.x.com/v1  ")).toBe("https://api.x.com/v1");
  });

  it("连续尾缀逐层剥(chat/completions + 尾斜杠);裸域名不动", () => {
    expect(normalizeBaseUrl("https://api.x.com/v1/messages/")).toBe("https://api.x.com");
    expect(normalizeBaseUrl("https://api.x.com")).toBe("https://api.x.com");
  });
});

describe("AiModelCreateSchema", () => {
  const valid = {
    name: "解读主力",
    provider: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-chat",
    apiKey: "sk-x",
    purposes: ["interpret"],
    supportsVision: false,
    concurrency: 4,
    timeoutSec: 60,
  };

  it("合法输入通过;apiKey 省略/空串允许(无鉴权)", () => {
    expect(AiModelCreateSchema.safeParse(valid).success).toBe(true);
    expect(AiModelCreateSchema.safeParse({ ...valid, apiKey: undefined }).success).toBe(true);
    expect(AiModelCreateSchema.safeParse({ ...valid, apiKey: "  " }).success).toBe(true);
  });

  it("空名/空供应商/空 purposes/非法协议/越界并发与超时拒收", () => {
    expect(AiModelCreateSchema.safeParse({ ...valid, name: " " }).success).toBe(false);
    expect(AiModelCreateSchema.safeParse({ ...valid, provider: "" }).success).toBe(false);
    expect(AiModelCreateSchema.safeParse({ ...valid, purposes: [] }).success).toBe(false);
    expect(AiModelCreateSchema.safeParse({ ...valid, purposes: ["bogus"] }).success).toBe(false);
    expect(AiModelCreateSchema.safeParse({ ...valid, protocol: "grpc" }).success).toBe(false);
    expect(AiModelCreateSchema.safeParse({ ...valid, concurrency: 0 }).success).toBe(false);
    expect(AiModelCreateSchema.safeParse({ ...valid, concurrency: 65 }).success).toBe(false);
    expect(AiModelCreateSchema.safeParse({ ...valid, timeoutSec: 4 }).success).toBe(false);
    expect(AiModelCreateSchema.safeParse({ ...valid, timeoutSec: 601 }).success).toBe(false);
  });
});
