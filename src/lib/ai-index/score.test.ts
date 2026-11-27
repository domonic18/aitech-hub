/**
 * AI 智能指数:打分与聚合单测
 * 验三件事:相关性闸(非 AI 资讯不入池)、带符号贡献(方向与置信度参与计算)、
 * 冲击分口径(滚动窗口百分位 + 质量门 + 异常日标记)。
 */
import { describe, expect, it } from "vitest";

import {
  directionSign,
  relevanceWeight,
  ruleBasedScore,
  ruleDirection,
  ruleRelevance,
  selectAiRelevant,
  signedImpact,
  type ScoredNewsItem,
} from "./score";
import { buildImpactSeries } from "./velocity";

function item(over: Partial<ScoredNewsItem>): ScoredNewsItem {
  return {
    id: "x",
    title: "标题",
    summary: "摘要",
    url: "#",
    publishedAt: "2026-11-01T00:00:00Z",
    impactScore: 50,
    confidence: 1,
    dimension: "model",
    relevance: "core",
    direction: "positive",
    scorer: "rule",
    ...over,
  };
}

describe("相关性闸", () => {
  it("模型发布类判为 core", () => {
    expect(
      ruleRelevance({
        id: "1",
        title: "OpenAI 发布 GPT-5",
        summary: "新模型",
        url: "#",
        publishedAt: "",
      }),
    ).toBe("core");
  });

  it("纯资本/基建类判为 adjacent", () => {
    expect(
      ruleRelevance({
        id: "2",
        title: "某公司完成融资",
        summary: "融资规模扩大,GPU 采购增加",
        url: "#",
        publishedAt: "",
      }),
    ).toBe("adjacent");
  });

  it("与 AI 无关的资讯判为 other", () => {
    expect(
      ruleRelevance({
        id: "3",
        title: "某地天气预报",
        summary: "明日有雨",
        url: "#",
        publishedAt: "",
      }),
    ).toBe("other");
  });

  it("selectAiRelevant 只保留 core 与 adjacent", () => {
    const kept = selectAiRelevant([
      item({ id: "1", relevance: "core" }),
      item({ id: "2", relevance: "adjacent" }),
      item({ id: "3", relevance: "other" }),
    ]);
    expect(kept.map((i) => i.id)).toEqual(["1", "2"]);
  });
});

describe("方向与带符号贡献", () => {
  it("负面关键词多于正面时判为 negative", () => {
    expect(
      ruleDirection({
        id: "1",
        title: "模型出现严重漏洞 泄露",
        summary: "监管收紧,禁止使用",
        url: "#",
        publishedAt: "",
      }),
    ).toBe("negative");
  });

  it("方向符号:正 1 / 负 -1 / 中性 0.4", () => {
    expect(directionSign("positive")).toBe(1);
    expect(directionSign("negative")).toBe(-1);
    expect(directionSign("neutral")).toBe(0.4);
  });

  it("相关性权重:core 1 / adjacent 0.5 / other 0", () => {
    expect(relevanceWeight("core")).toBe(1);
    expect(relevanceWeight("adjacent")).toBe(0.5);
    expect(relevanceWeight("other")).toBe(0);
  });

  it("带符号贡献 = 冲击分 × 方向 × 置信度 × 相关性权重", () => {
    expect(signedImpact(item({ impactScore: 80, confidence: 0.5, direction: "positive" }))).toBe(
      40,
    );
    expect(signedImpact(item({ impactScore: 80, confidence: 0.5, direction: "negative" }))).toBe(
      -40,
    );
    expect(signedImpact(item({ impactScore: 80, confidence: 1, relevance: "adjacent" }))).toBe(40);
  });

  it("规则打分产出完整的相关性/方向字段", () => {
    const s = ruleBasedScore({
      id: "1",
      title: "OpenAI 发布 GPT-5",
      summary: "推理能力大幅提升",
      url: "#",
      publishedAt: "",
    });
    expect(s.relevance).toBe("core");
    expect(s.direction).toBe("positive");
    expect(s.score).toBeGreaterThan(30);
  });
});

describe("冲击分聚合", () => {
  it("无条目日为 no_data,且不参与百分位窗口", () => {
    const items = [
      item({ id: "1", publishedAt: "2026-11-01T00:00:00Z", impactScore: 100 }),
      item({ id: "2", publishedAt: "2026-11-03T00:00:00Z", impactScore: 10 }),
    ];
    const series = buildImpactSeries(items);
    expect(series).toHaveLength(3);
    expect(series[1].quality).toBe("no_data");
    expect(series[1].netImpact).toBeNull();
    expect(series[0].impactIndex).not.toBeNull();
    expect(series[2].impactIndex).not.toBeNull();
  });

  it("冲击更强的一天百分位高于更弱的一天", () => {
    const items = [
      item({ id: "1", publishedAt: "2026-11-01T00:00:00Z", impactScore: 20 }),
      item({ id: "2", publishedAt: "2026-11-02T00:00:00Z", impactScore: 90 }),
      item({ id: "3", publishedAt: "2026-11-03T00:00:00Z", impactScore: 30 }),
    ];
    const series = buildImpactSeries(items);
    const indexOf = (id: string) =>
      series.find((p) => p.itemCount > 0 && p.date === id)?.impactIndex ?? 0;
    expect(indexOf("2026-11-02")).toBeGreaterThan(indexOf("2026-11-01"));
    expect(indexOf("2026-11-02")).toBeGreaterThan(indexOf("2026-11-03"));
  });

  it("负向事件拉低当日净冲击", () => {
    const items = [
      item({
        id: "1",
        publishedAt: "2026-11-01T00:00:00Z",
        impactScore: 50,
        direction: "positive",
      }),
      item({
        id: "2",
        publishedAt: "2026-11-01T00:00:00Z",
        impactScore: 80,
        direction: "negative",
      }),
    ];
    const series = buildImpactSeries(items);
    expect(series[0].netImpact).toBe(50 - 80);
    expect(series[0].negativeImpact).toBe(-80);
  });
});
