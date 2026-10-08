import { describe, expect, it } from "vitest";

import {
  matchBlocklist,
  matchHeuristics,
  matchesIncludeKeywords,
  parseIncludeKeywords,
} from "./filter";

describe("matchBlocklist", () => {
  const words = [
    { word: "彩票", scope: "all" as const },
    { word: "AI", scope: "title" as const },
    { word: "广告", scope: "summary" as const },
  ];

  it("scope=title 只查标题,大小写不敏感", () => {
    expect(matchBlocklist("最新 ai 资讯", "正文", words)).toEqual({
      rule: "blocklist:AI",
      word: "AI",
    });
    expect(matchBlocklist("无关标题", "提到 ai", words)).toBeNull();
  });

  it("scope=summary 只查摘要,scope=all 双查", () => {
    expect(matchBlocklist("标题", "这里讲广告投放", words)).toEqual({
      rule: "blocklist:广告",
      word: "广告",
    });
    expect(matchBlocklist("标题", "买彩票", words)).toEqual({
      rule: "blocklist:彩票",
      word: "彩票",
    });
  });

  it("空词表不误伤", () => {
    expect(matchBlocklist("任何", "任何", [])).toBeNull();
  });
});

describe("matchHeuristics", () => {
  it("广告导流词命中(标题)", () => {
    expect(matchHeuristics("新模型发布 限时优惠", "正文")).toEqual({
      rule: "ad_kw:限时优惠",
      word: "限时优惠",
    });
  });

  it("标题党词命中", () => {
    expect(matchHeuristics("震惊!这个模型太强了", "正文")).toEqual({
      rule: "clickbait:震惊",
      word: "震惊",
    });
  });

  it("编码异常命中 garbled", () => {
    expect(matchHeuristics("正常标题", "�".repeat(10) + "ab")).toEqual({
      rule: "garbled",
      word: "",
    });
  });

  it("干净内容返回 null(正文提及广告词不算——启发只看标题)", () => {
    expect(matchHeuristics("Google 发布新广告系统论文", "正文提到广告技术")).toBeNull();
  });
});

describe("parseIncludeKeywords", () => {
  it("正常数组原样返回(仅 trim 去空)", () => {
    expect(parseIncludeKeywords({ includeKeywords: [" AI ", "大模型", ""] })).toEqual([
      "AI",
      "大模型",
    ]);
  });

  it("config 为空/非对象/缺键/非数组 → 空数组(不启用主题准入)", () => {
    expect(parseIncludeKeywords(undefined)).toEqual([]);
    expect(parseIncludeKeywords(null)).toEqual([]);
    expect(parseIncludeKeywords("bad")).toEqual([]);
    expect(parseIncludeKeywords(["not", "an", "object"])).toEqual([]);
    expect(parseIncludeKeywords({ other: 1 })).toEqual([]);
    expect(parseIncludeKeywords({ includeKeywords: "not-array" })).toEqual([]);
  });

  it("容错脏数据:非串条目滤除、单个截 30 字符、最多 10 个", () => {
    expect(parseIncludeKeywords({ includeKeywords: [1, null, "AI", {}] })).toEqual(["AI"]);
    const long = "字".repeat(40);
    expect(parseIncludeKeywords({ includeKeywords: [long] })[0].length).toBe(30);
    const many = Array.from({ length: 15 }, (_, i) => `词${i}`);
    expect(parseIncludeKeywords({ includeKeywords: many }).length).toBe(10);
  });
});

describe("matchesIncludeKeywords", () => {
  const words = ["AI", "人工智能", "大模型"];

  it("空关键词 = 不启用,恒放行", () => {
    expect(matchesIncludeKeywords("任意标题", "任意摘要", [])).toBe(true);
  });

  it("标题或摘要命中任一关键词即放行,大小写不敏感", () => {
    expect(matchesIncludeKeywords("New AI model released", "body", words)).toBe(true);
    expect(matchesIncludeKeywords("标题无关键词", "摘要提到大模型进展", words)).toBe(true);
    expect(matchesIncludeKeywords("gemini update", "gemini is an ai system", words)).toBe(true);
  });

  it("标题与摘要都不含任何关键词 → 拦下", () => {
    expect(matchesIncludeKeywords("周末去哪玩", "一份旅行攻略", words)).toBe(false);
  });
});
