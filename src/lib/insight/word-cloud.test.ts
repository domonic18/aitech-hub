/** 词云螺旋排布纯函数单测(M34 批③ 验收反馈·问题3):无重叠/边界内/高分词
 * 居中/竖排比例/窄画布截断;M46 验收批增舆情四色映射用例。measure 以等宽近似
 * 模拟 canvas 量测。 */
import { describe, expect, it } from "vitest";

import type { InsightCloudWord } from "./hotboard";
import { GAP, SENTIMENT_LEGEND, packWords, sentimentColor, sentimentOf } from "./word-cloud";

const W = 800;
const H = 300;

/** 等宽近似量测:px 高、0.62×px/字宽(与 canvas 实测同量级) */
const measure = (text: string, px: number) => ({
  w: text.length * px * 0.62,
  h: px * 1.15,
});

function box(p: ReturnType<typeof packWords>[number]): { w: number; h: number } {
  const m = measure(p.word.word, p.px);
  return p.vertical ? { w: m.h, h: m.w } : m;
}

function mkWords(n: number): InsightCloudWord[] {
  return Array.from({ length: n }, (_, i) => ({
    word: `词${i}`,
    weight: 100 - i * 2,
    clusterId: String(i + 1),
    label: `簇${i + 1}`,
    sentiment: (["positive", "neutral", "negative", "mixed"] as const)[i % 4],
  }));
}

describe("sentimentColor / sentimentOf / SENTIMENT_LEGEND", () => {
  it("舆情四色映射(null 未打标归中性)与图例序", () => {
    expect(sentimentColor("positive")).toBe("var(--green-hi)");
    expect(sentimentColor("negative")).toBe("var(--red-hi)");
    expect(sentimentColor("mixed")).toBe("var(--amber-hi)");
    expect(sentimentColor("neutral")).toBe("var(--text-2)");
    expect(sentimentColor(null)).toBe("var(--text-2)");
    expect(sentimentOf(null)).toBe("neutral");
    expect(sentimentOf("mixed")).toBe("mixed");
    expect(SENTIMENT_LEGEND.map((l) => l.label)).toEqual(["正面", "中性", "负面", "争议"]);
  });
});

describe("packWords", () => {
  it("空输入返回空数组", () => {
    expect(packWords([], W, H, measure)).toEqual([]);
  });

  it("全部落位且互不重叠(含 GAP)、均在画布边界内", () => {
    const placed = packWords(mkWords(30), W, H, measure);
    expect(placed.length).toBe(30);
    for (const p of placed) {
      const { w, h } = box(p);
      expect(p.x - w / 2).toBeGreaterThanOrEqual(0);
      expect(p.x + w / 2).toBeLessThanOrEqual(W);
      expect(p.y - h / 2).toBeGreaterThanOrEqual(0);
      expect(p.y + h / 2).toBeLessThanOrEqual(H);
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const ab = box(a);
        const bb = box(b);
        const apart =
          Math.abs(a.x - b.x) >= (ab.w + bb.w) / 2 + GAP ||
          Math.abs(a.y - b.y) >= (ab.h + bb.h) / 2 + GAP;
        expect(apart, `「${a.word.word}」与「${b.word.word}」重叠`).toBe(true);
      }
    }
  });

  it("权重降序输入时高分词更靠近中心(前 5 词质心距 < 后 5 词质心距)", () => {
    const placed = packWords(mkWords(24), W, H, measure);
    const dist = (p: (typeof placed)[number]) => Math.hypot(p.x - W / 2, p.y - H / 2);
    const head = placed.slice(0, 5).reduce((a, p) => a + dist(p), 0) / 5;
    const tail = placed.slice(-5).reduce((a, p) => a + dist(p), 0) / 5;
    expect(head).toBeLessThan(tail);
  });

  it("≥8 词启用竖排(i%4===2)且超宽词缩字号仍可落位", () => {
    const longWords: InsightCloudWord[] = [
      { word: "超长关键词测试文本一号", weight: 90, clusterId: "1", label: "L", sentiment: null },
      { word: "短", weight: 80, clusterId: "2", label: "S", sentiment: "positive" },
      { word: "超长关键词测试文本二号", weight: 70, clusterId: "3", label: "L2", sentiment: null },
      {
        word: "另一个超长关键词测试文本三号",
        weight: 60,
        clusterId: "4",
        label: "L3",
        sentiment: null,
      },
      ...mkWords(10),
    ];
    const placed = packWords(longWords, 400, H, measure);
    expect(placed.some((p) => p.vertical)).toBe(true);
    // 全部尝试落位(超宽缩字号后不因放不下而全灭)
    expect(placed.length).toBeGreaterThan(8);
  });

  it("画布过窄时截断而非溢出", () => {
    const placed = packWords(mkWords(40), 120, H, measure);
    expect(placed.length).toBeLessThan(40);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(120);
    }
  });
});
