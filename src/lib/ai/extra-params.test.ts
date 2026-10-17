/**
 * extraParams 读取纯函数单测(2026-10-17 max_tokens 截断根修):类型门放行
 * 正整数、未配置/配错型返 null、「配过」与「配对」可区分;output_config 只认
 * 普通对象。数值零 hardcode——合法域判定是类型门,不是默认值。
 */
import { describe, expect, it } from "vitest";

import { hasExtraMaxTokens, readExtraMaxTokens, readExtraOutputConfig } from "./extra-params";

describe("readExtraMaxTokens", () => {
  it("正整数放行", () => {
    expect(readExtraMaxTokens({ max_tokens: 131_072 })).toBe(131_072);
    expect(readExtraMaxTokens({ max_tokens: 1 })).toBe(1);
  });

  it("未配置 → null", () => {
    expect(readExtraMaxTokens({})).toBeNull();
    expect(readExtraMaxTokens({ other: 1 })).toBeNull();
  });

  it("配错型 → null(字符串/负数/小数/零/null)", () => {
    expect(readExtraMaxTokens({ max_tokens: "131072" })).toBeNull();
    expect(readExtraMaxTokens({ max_tokens: -1 })).toBeNull();
    expect(readExtraMaxTokens({ max_tokens: 1.5 })).toBeNull();
    expect(readExtraMaxTokens({ max_tokens: 0 })).toBeNull();
    expect(readExtraMaxTokens({ max_tokens: null })).toBeNull();
  });
});

describe("hasExtraMaxTokens", () => {
  it("区分「配过但配错」与「没配」", () => {
    expect(hasExtraMaxTokens({ max_tokens: "x" })).toBe(true);
    expect(hasExtraMaxTokens({})).toBe(false);
  });
});

describe("readExtraOutputConfig", () => {
  it("普通对象原样返回", () => {
    const cfg = { effort: "high" };
    expect(readExtraOutputConfig({ output_config: cfg })).toBe(cfg);
  });

  it("未配置/非对象 → null", () => {
    expect(readExtraOutputConfig({})).toBeNull();
    expect(readExtraOutputConfig({ output_config: "max" })).toBeNull();
    expect(readExtraOutputConfig({ output_config: ["max"] })).toBeNull();
    expect(readExtraOutputConfig({ output_config: null })).toBeNull();
  });
});
