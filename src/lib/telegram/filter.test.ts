import { describe, expect, it } from "vitest";

import { matchBlocklist, matchHeuristics } from "./filter";

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
