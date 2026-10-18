/** 洞察日批纯函数单测:机会评分卡/覆盖度分与档位/异动判定/打标契约解析。 */
import { describe, expect, it } from "vitest";

import {
  computeCoverageScore,
  computeOpportunityScore,
  coverageStateOf,
  isAnomaly,
  parseInsightLabel,
} from "./label";

describe("computeOpportunityScore", () => {
  it("三项加权:介质广度×40 + 近 7 日热度×30 + 内容空白×30", () => {
    // 介质 2/5=16 + 热度 5/10=15 + 空白(coverage=0.5)=15 → 46
    expect(computeOpportunityScore({ mediaCount: 2, heatNew: 5, coverage: 0.5 })).toBe(46);
  });

  it("各维饱和封顶(介质 5+、热度 10+)", () => {
    // 40 + 30 + (1-0)×30 = 100
    expect(computeOpportunityScore({ mediaCount: 9, heatNew: 99, coverage: 0 })).toBe(100);
  });

  it("覆盖度未回写(null)按空白满额处理,促日批回写", () => {
    expect(computeOpportunityScore({ mediaCount: 0, heatNew: 0, coverage: null })).toBe(30);
  });

  it("全被覆盖且无介质无热度 → 0", () => {
    expect(computeOpportunityScore({ mediaCount: 0, heatNew: 0, coverage: 1 })).toBe(0);
  });
});

describe("computeCoverageScore / coverageStateOf", () => {
  it("最佳相似度 × 命中数饱和因子(3 篇饱和)", () => {
    // 1-0.1=0.9,命中 3 → 0.9
    expect(computeCoverageScore(0.1, 3)).toBe(0.9);
    // 1-0.1=0.9,命中 1 → 0.3
    expect(computeCoverageScore(0.1, 1)).toBe(0.3);
    // 无命中调用方直接传 0,此处远距 → 低分
    expect(computeCoverageScore(0.8, 5)).toBe(0.2);
  });

  it("档位:covered ≥ 0.5 / partial ≥ 0.15 / blank", () => {
    expect(coverageStateOf(0.5)).toBe("covered");
    expect(coverageStateOf(0.49)).toBe("partial");
    expect(coverageStateOf(0.15)).toBe("partial");
    expect(coverageStateOf(0.14)).toBe("blank");
  });
});

describe("isAnomaly", () => {
  it("最新分 ≥ 前 3 日均值 3 倍且绝对增量 ≥ 10 → 告警", () => {
    // 前 3 日均值 10,最新 40(4 倍,+30)
    expect(isAnomaly([8, 10, 12, 40])).toBe(true);
  });

  it("倍数够但绝对增量不足 → 不告警(双门)", () => {
    // 均值 5,最新 15(3 倍但 +10 恰达下限 → 告警);改 +9 场景:
    expect(isAnomaly([4, 5, 6, 15])).toBe(true);
    expect(isAnomaly([4, 5, 6, 14])).toBe(false); // 14 < 3×5
  });

  it("基线为零/无历史/样本不足 → 不告警(防冷启动假告警)", () => {
    expect(isAnomaly([0, 0, 0, 30])).toBe(false);
    expect(isAnomaly([40])).toBe(false);
    expect(isAnomaly([])).toBe(false);
  });

  it("平稳序列不告警", () => {
    expect(isAnomaly([10, 11, 12, 11])).toBe(false);
  });
});

describe("parseInsightLabel", () => {
  it("合法契约:截断到库列宽,keywords 清洗去空", () => {
    const r = parseInsightLabel(
      JSON.stringify({
        label: "AI 编程工具选型困惑",
        summary: "用户在多个 AI 编程工具间难以抉择,需要对比评测内容。",
        keywords: ["Cursor", " ", "Copilot", "对比"],
      }),
    );
    expect(r).toEqual({
      ok: true,
      data: {
        label: "AI 编程工具选型困惑",
        summary: "用户在多个 AI 编程工具间难以抉择,需要对比评测内容。",
        keywords: ["Cursor", "Copilot", "对比"],
      },
    });
  });

  it("非 JSON / 非对象 / 缺字段 / 空 keywords → ok:false 带错误串", () => {
    expect(parseInsightLabel("不是 JSON").ok).toBe(false);
    expect(parseInsightLabel("[1,2]").ok).toBe(false);
    expect(parseInsightLabel(JSON.stringify({ label: "", summary: "s", keywords: ["k"] })).ok).toBe(
      false,
    );
    expect(parseInsightLabel(JSON.stringify({ label: "l", summary: "s", keywords: [] })).ok).toBe(
      false,
    );
    expect(parseInsightLabel(JSON.stringify({ label: "l", keywords: ["k"] })).ok).toBe(false);
  });

  it("label/summary/keywords 超长截断到 200/1000/8 项", () => {
    const r = parseInsightLabel(
      JSON.stringify({
        label: "长".repeat(300),
        summary: "概".repeat(1200),
        keywords: Array.from({ length: 12 }, (_, i) => `k${i}${"x".repeat(50)}`),
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.label.length).toBe(200);
      expect(r.data.summary.length).toBe(1000);
      expect(r.data.keywords.length).toBe(8);
      expect(r.data.keywords[0]!.length).toBe(40);
    }
  });
});
