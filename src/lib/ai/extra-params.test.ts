/**
 * extraParams 读取纯函数单测(2026-10-17 max_tokens 截断根修;2026-10 模型
 * 切换补 temperature):类型门放行正整数/0–2 温度、未配置/配错型返 null、
 * 「配过」与「配对」可区分;output_config 只认普通对象。数值零 hardcode——
 * 合法域判定是类型门,不是默认值。
 */
import { describe, expect, it } from "vitest";

import {
  hasExtraMaxTokens,
  hasExtraTemperature,
  readExtraMaxTokens,
  readExtraOutputConfig,
  readExtraTemperature,
} from "./extra-params";

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

describe("readExtraTemperature", () => {
  it("0–2 有限数放行(含 0 与 1,thinking 开启时 1 合法)", () => {
    expect(readExtraTemperature({ temperature: 0 })).toBe(0);
    expect(readExtraTemperature({ temperature: 1 })).toBe(1);
    expect(readExtraTemperature({ temperature: 0.3 })).toBe(0.3);
    expect(readExtraTemperature({ temperature: 2 })).toBe(2);
  });

  it("未配置 → null", () => {
    expect(readExtraTemperature({})).toBeNull();
    expect(readExtraTemperature({ other: 0.3 })).toBeNull();
  });

  it("配错型 → null(字符串/越界/NaN/Infinity/null)", () => {
    expect(readExtraTemperature({ temperature: "0.3" })).toBeNull();
    expect(readExtraTemperature({ temperature: -0.1 })).toBeNull();
    expect(readExtraTemperature({ temperature: 2.1 })).toBeNull();
    expect(readExtraTemperature({ temperature: Number.NaN })).toBeNull();
    expect(readExtraTemperature({ temperature: Number.POSITIVE_INFINITY })).toBeNull();
    expect(readExtraTemperature({ temperature: null })).toBeNull();
  });
});

describe("hasExtraTemperature", () => {
  it("区分「配过但配错」与「没配」", () => {
    expect(hasExtraTemperature({ temperature: "x" })).toBe(true);
    expect(hasExtraTemperature({})).toBe(false);
  });
});
