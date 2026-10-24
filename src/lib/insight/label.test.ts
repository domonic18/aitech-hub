/** LLM 打标契约单测:kind 语义判定字段(hot|pain 枚举硬校验)+ sentiment 舆情
 * 四值枚举(M46 验收批)+ 截断清洗。纯函数评分/异动/动量用例在 scoring.test.ts。 */
import { describe, expect, it } from "vitest";

import { parseInsightLabel } from "./label";

describe("parseInsightLabel", () => {
  it("合法契约:截断到库列宽,keywords 清洗去空,kind/sentiment 枚举透传", () => {
    const r = parseInsightLabel(
      JSON.stringify({
        label: "AI 编程工具选型困惑",
        summary: "用户在多个 AI 编程工具间难以抉择,需要对比评测内容。",
        keywords: ["Cursor", " ", "Copilot", "对比"],
        kind: "pain",
        sentiment: "negative",
      }),
    );
    expect(r).toEqual({
      ok: true,
      data: {
        label: "AI 编程工具选型困惑",
        summary: "用户在多个 AI 编程工具间难以抉择,需要对比评测内容。",
        keywords: ["Cursor", "Copilot", "对比"],
        kind: "pain",
        sentiment: "negative",
      },
    });
    const hot = parseInsightLabel(
      JSON.stringify({
        label: "l",
        summary: "s",
        keywords: ["k"],
        kind: "hot",
        sentiment: "mixed",
      }),
    );
    expect(hot.ok && hot.data.kind).toBe("hot");
    expect(hot.ok && hot.data.sentiment).toBe("mixed");
  });

  it("非 JSON / 非对象 / 缺字段 / kind 非法 / sentiment 非法或缺失 / 空 keywords → ok:false 带错误串", () => {
    expect(parseInsightLabel("不是 JSON").ok).toBe(false);
    expect(parseInsightLabel("[1,2]").ok).toBe(false);
    expect(
      parseInsightLabel(
        JSON.stringify({
          label: "",
          summary: "s",
          keywords: ["k"],
          kind: "hot",
          sentiment: "neutral",
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseInsightLabel(
        JSON.stringify({
          label: "l",
          summary: "s",
          keywords: [],
          kind: "hot",
          sentiment: "neutral",
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseInsightLabel(
        JSON.stringify({ label: "l", keywords: ["k"], kind: "hot", sentiment: "neutral" }),
      ).ok,
    ).toBe(false);
    expect(
      parseInsightLabel(
        JSON.stringify({ label: "l", summary: "s", keywords: ["k"], sentiment: "neutral" }),
      ).ok,
    ).toBe(false);
    expect(
      parseInsightLabel(
        JSON.stringify({
          label: "l",
          summary: "s",
          keywords: ["k"],
          kind: "topic",
          sentiment: "neutral",
        }),
      ).ok,
    ).toBe(false);
    // sentiment 缺失/非法四值之外 → 拒绝(LLM 重试自纠,不落脏值)
    expect(
      parseInsightLabel(JSON.stringify({ label: "l", summary: "s", keywords: ["k"], kind: "hot" }))
        .ok,
    ).toBe(false);
    expect(
      parseInsightLabel(
        JSON.stringify({
          label: "l",
          summary: "s",
          keywords: ["k"],
          kind: "hot",
          sentiment: "angry",
        }),
      ).ok,
    ).toBe(false);
  });

  it("label/summary/keywords 超长截断到 200/1000/8 项", () => {
    const r = parseInsightLabel(
      JSON.stringify({
        label: "长".repeat(300),
        summary: "概".repeat(1200),
        keywords: Array.from({ length: 12 }, (_, i) => `k${i}${"x".repeat(50)}`),
        kind: "hot",
        sentiment: "neutral",
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
