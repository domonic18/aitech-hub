/** 词候选治理纯函数单测(F24):相似度口径与来源 label */
import { describe, expect, it } from "vitest";

import { candidateOriginLabel, levenshtein, wordSimilarity } from "./candidate-words";

describe("levenshtein", () => {
  it("空串与相等", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("rag", "rag")).toBe(0);
  });

  it("单字符差异", () => {
    expect(levenshtein("rag", "tag")).toBe(1);
    expect(levenshtein("rag 检索", "rag 召回")).toBe(2);
  });
});

describe("wordSimilarity", () => {
  it("同词 = 1", () => {
    expect(wordSimilarity("rag", "rag")).toBe(1);
  });

  it("包含关系按长度占比(rag ⊂ rag 检索)", () => {
    // 3/6 = 0.5,低于阈值但高于编辑距离率
    expect(wordSimilarity("rag", "rag 检索")).toBeCloseTo(0.5);
  });

  it("高相似对达合并阈值(板例量级)", () => {
    expect(wordSimilarity("mcp 记忆", "mcp 记忆管理")).toBeGreaterThanOrEqual(0.75);
    expect(wordSimilarity("code review", "code  review")).toBeGreaterThanOrEqual(0.75);
  });

  it("无关词接近 0", () => {
    expect(wordSimilarity("rag", "vllm 量化")).toBeLessThan(0.3);
  });

  it("空串安全", () => {
    expect(wordSimilarity("", "rag")).toBe(0);
    expect(wordSimilarity("rag", "")).toBe(0);
  });
});

describe("candidateOriginLabel", () => {
  it("手动 / B站联想 / 其余联想源", () => {
    expect(candidateOriginLabel("manual", null)).toBe("手动");
    expect(candidateOriginLabel("hotword", "bili-suggest")).toBe("B站发现");
    expect(candidateOriginLabel("hotword", "bing-suggest")).toBe("热词发现");
    expect(candidateOriginLabel("hotword", null)).toBe("热词发现");
  });
});
