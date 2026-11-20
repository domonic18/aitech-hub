/**
 * 上下文长度推导单测:由档位的输入长度阶梯推上限。
 */
import { describe, expect, it } from "vitest";

import {
  CONTEXT_BANDS,
  contextTokensFromTiers,
  formatContextTokens,
  inContextBand,
  parseContextTokens,
} from "./context";

describe("context(上下文长度)", () => {
  it("token 数 → 展示口径(1M / 256K / 原样)", () => {
    expect(formatContextTokens(1024 * 1024)).toBe("1M");
    expect(formatContextTokens(256 * 1024)).toBe("256K");
    expect(formatContextTokens(1000)).toBe("1000");
    expect(formatContextTokens(null)).toBeNull();
    expect(formatContextTokens(0)).toBeNull();
  });

  it("阶梯上界即上下文封顶(取各档最大上界)", () => {
    expect(
      contextTokensFromTiers([
        { minTokens: 0, maxTokens: 32768 },
        { minTokens: 32768, maxTokens: 131072 },
        { minTokens: 131072, maxTokens: 262144 },
      ]),
    ).toBe(262144);
  });

  it("最高档无上界时取其下界(那一档的起点就是封顶处)", () => {
    expect(
      contextTokensFromTiers([
        { minTokens: 0, maxTokens: 131072 },
        { minTokens: 131072, maxTokens: null },
      ]),
    ).toBe(131072);
  });

  it("无边界档位(默认档/非 token 行)不参与推导", () => {
    expect(
      contextTokensFromTiers([
        { minTokens: null, maxTokens: null },
        { minTokens: null, maxTokens: null },
      ]),
    ).toBeNull();
    expect(contextTokensFromTiers([])).toBeNull();
  });
});

describe("parseContextTokens / inContextBand(上下文解析与分档)", () => {
  it("K/M 记法 → token 数;认不出 → null", () => {
    expect(parseContextTokens("128K")).toBe(131072);
    expect(parseContextTokens("1M")).toBe(1048576);
    expect(parseContextTokens("200000")).toBe(200000);
    expect(parseContextTokens(null)).toBeNull();
    expect(parseContextTokens("—")).toBeNull();
  });

  it("分档:未知档只收未标注;下界档按 token 数", () => {
    expect(inContextBand(null, "unknown")).toBe(true);
    expect(inContextBand(131072, "unknown")).toBe(false);
    expect(inContextBand(1048576, "ge1m")).toBe(true);
    expect(inContextBand(131072, "ge1m")).toBe(false);
    expect(inContextBand(65536, "lt128k")).toBe(true);
    expect(inContextBand(null, "lt128k")).toBe(false);
    expect(inContextBand(null, "all")).toBe(true);
  });

  it("分档档位表:all/unknown/三档下界", () => {
    expect(CONTEXT_BANDS.map((b) => b.id)).toEqual([
      "all",
      "ge1m",
      "ge256k",
      "ge128k",
      "lt128k",
      "unknown",
    ]);
  });
});
