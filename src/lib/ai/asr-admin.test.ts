/**
 * ASR 配置 schema 边界单测:时长上下限、热词去空串后上限、apiKey 可选。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../env", () => ({ env: { AUTH_SECRET: "unit-test-auth-secret-0123456789" } }));

import { AsrUpdateSchema } from "./asr-admin";

const valid = {
  provider: "SiliconFlow",
  protocol: "openai",
  baseUrl: "https://api.siliconflow.cn/v1",
  modelId: "SenseVoiceSmall",
  maxAudioSeconds: 600,
  hotwords: ["大模型", "智能体"],
  enabled: false,
};

describe("AsrUpdateSchema", () => {
  it("合法输入通过;apiKey 省略允许(留空保留语义在服务层)", () => {
    expect(AsrUpdateSchema.safeParse(valid).success).toBe(true);
    expect(AsrUpdateSchema.safeParse({ ...valid, apiKey: undefined }).success).toBe(true);
  });

  it("时长越界(9s/7201s)/空供应商/空 modelId/非法协议拒收", () => {
    expect(AsrUpdateSchema.safeParse({ ...valid, maxAudioSeconds: 9 }).success).toBe(false);
    expect(AsrUpdateSchema.safeParse({ ...valid, maxAudioSeconds: 7201 }).success).toBe(false);
    expect(AsrUpdateSchema.safeParse({ ...valid, provider: "" }).success).toBe(false);
    expect(AsrUpdateSchema.safeParse({ ...valid, modelId: " " }).success).toBe(false);
    expect(AsrUpdateSchema.safeParse({ ...valid, protocol: "grpc" }).success).toBe(false);
  });

  it("热词上限 50;单条超 50 字拒收", () => {
    expect(
      AsrUpdateSchema.safeParse({
        ...valid,
        hotwords: Array.from({ length: 51 }, (_, i) => `词${i}`),
      }).success,
    ).toBe(false);
    expect(AsrUpdateSchema.safeParse({ ...valid, hotwords: ["x".repeat(51)] }).success).toBe(false);
  });
});
