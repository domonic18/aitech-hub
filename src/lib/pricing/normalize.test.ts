/**
 * 牌价键归一单测(M74 批A):model_key / match_key / family 三级键的规则。
 * 纯函数,无库无 env。
 */
import { describe, expect, it } from "vitest";

import {
  deriveFamily,
  displayNameFromModelKey,
  normalizeMatchKey,
  normalizeModelKey,
} from "./normalize";

describe("normalizeModelKey", () => {
  it("去厂商前缀 + 小写 + 分隔符统一", () => {
    expect(normalizeModelKey("Qwen/Qwen3-235B-A22B")).toBe("qwen3-235b-a22b");
    expect(normalizeModelKey("deepseek-v3.2")).toBe("deepseek-v3-2");
    expect(normalizeModelKey("deepseek_chat")).toBe("deepseek-chat");
    expect(normalizeModelKey("  GLM-4.6  ")).toBe("glm-4-6");
  });

  it("空串与纯符号归一后为空(不可落库)", () => {
    expect(normalizeModelKey("")).toBe("");
    expect(normalizeModelKey("   ")).toBe("");
    expect(normalizeModelKey("///")).toBe("");
  });

  it("连续分隔符折叠、首尾去横杠", () => {
    expect(normalizeModelKey("--a--b--")).toBe("a-b");
    expect(normalizeModelKey("a..b__c")).toBe("a-b-c");
  });
});

describe("normalizeMatchKey", () => {
  it("摘掉日期快照后缀,同模型不同快照归到同一锚", () => {
    expect(normalizeMatchKey("gpt-4o-2024-08-06")).toBe("gpt-4o");
    expect(normalizeMatchKey("gpt-4o")).toBe("gpt-4o");
    expect(normalizeMatchKey("gpt-4o-2024-08-06")).toBe(normalizeMatchKey("gpt-4o"));
  });

  it("摘别名后缀(latest/preview/stable/exp)", () => {
    expect(normalizeMatchKey("qwen3-max-latest")).toBe("qwen3-max");
    expect(normalizeMatchKey("qwen3-max-preview")).toBe("qwen3-max");
  });

  it("日期快照 + 别名叠加时两轮摘净", () => {
    expect(normalizeMatchKey("gpt-4o-2024-08-06-latest")).toBe("gpt-4o");
  });

  it("不误伤真实版本号(单数字/带单位后缀不算快照)", () => {
    expect(normalizeMatchKey("deepseek-v3")).toBe("deepseek-v3");
    expect(normalizeMatchKey("qwen3-235b-a22b")).toBe("qwen3-235b-a22b");
    expect(normalizeMatchKey("glm-4-6")).toBe("glm-4-6");
  });
});

describe("deriveFamily", () => {
  it("取开头连续的产品名段", () => {
    expect(deriveFamily("qwen3-235b-a22b")).toBe("qwen3");
    expect(deriveFamily("deepseek-v3-2")).toBe("deepseek-v3");
    expect(deriveFamily("doubao-seed-2-1-pro")).toBe("doubao-seed");
    expect(deriveFamily("text-embedding-3-large")).toBe("text-embedding");
    expect(deriveFamily("kimi-k2")).toBe("kimi-k2");
  });

  it("变体词断在产品线之外(deepseek-flash → deepseek)", () => {
    expect(deriveFamily("deepseek-flash")).toBe("deepseek");
    expect(deriveFamily("kimi-k2-instruct")).toBe("kimi-k2");
    expect(deriveFamily("ernie-4-0-turbo")).toBe("ernie");
  });

  it("首段即数字则无产品线", () => {
    expect(deriveFamily("8b-model")).toBeNull();
  });
});

describe("displayNameFromModelKey", () => {
  it("保留官方大小写,去厂商前缀", () => {
    expect(displayNameFromModelKey("Qwen/Qwen3-235B-A22B")).toBe("Qwen3-235B-A22B");
    expect(displayNameFromModelKey("  gpt-4o ")).toBe("gpt-4o");
  });
});
