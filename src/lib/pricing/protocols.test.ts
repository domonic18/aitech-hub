/**
 * 模型支持协议(策展规则)单测:只标有官方文档可证的,认不出不标。
 */
import { describe, expect, it } from "vitest";

import {
  PROTOCOL_COLORS,
  PROTOCOL_OPTIONS,
  protocolsLabel,
  resolveApiProtocols,
} from "./protocols";

describe("protocols(支持的 API 协议)", () => {
  it("百炼/火山/腾讯:OpenAI 兼容 + Anthropic 兼容", () => {
    expect(resolveApiProtocols("aliyun-bailian", "qwen3-max")).toEqual(["openai", "anthropic"]);
    expect(resolveApiProtocols("volcengine-ark", "doubao-seed-pro")).toEqual([
      "openai",
      "anthropic",
    ]);
    expect(resolveApiProtocols("tencent-cloud", "hunyuan-a13b")).toEqual(["openai", "anthropic"]);
  });

  it("Kimi/DeepSeek:只 OpenAI 兼容", () => {
    expect(resolveApiProtocols("moonshot", "kimi-k2")).toEqual(["openai"]);
    expect(resolveApiProtocols("deepseek", "deepseek-chat")).toEqual(["openai"]);
  });

  it("硅基流动:Claude 模型额外支持 Anthropic 兼容端点", () => {
    expect(resolveApiProtocols("siliconflow", "deepseek-ai/DeepSeek-V3.2")).toEqual(["openai"]);
    expect(resolveApiProtocols("siliconflow", "anthropic/claude-sonnet-4")).toEqual([
      "openai",
      "anthropic",
    ]);
  });

  it("聚合挂牌平台与未知厂商:不标(空 ≠ 不支持)", () => {
    expect(resolveApiProtocols("baidu-ciyuansuo", "gpt-4o")).toEqual([]);
    expect(resolveApiProtocols(null, "gpt-4o")).toEqual([]);
    expect(resolveApiProtocols("unknown-vendor", "gpt-4o")).toEqual([]);
  });

  it("筛选项与视觉映射覆盖全部协议", () => {
    expect(PROTOCOL_OPTIONS.map((o) => o.id)).toEqual(["openai", "anthropic"]);
    for (const o of PROTOCOL_OPTIONS) {
      expect(PROTOCOL_COLORS[o.id]).toBeDefined();
      expect(PROTOCOL_COLORS[o.id].border).toContain("border-");
      expect(PROTOCOL_COLORS[o.id].bg).toContain("bg-");
      expect(PROTOCOL_COLORS[o.id].text).toContain("text-");
    }
  });

  it("展示文案", () => {
    expect(protocolsLabel(["openai"])).toBe("OpenAI 兼容");
    expect(protocolsLabel(["openai", "anthropic"])).toBe("OpenAI 兼容 · Anthropic 兼容");
    expect(protocolsLabel([])).toBe("");
  });
});
