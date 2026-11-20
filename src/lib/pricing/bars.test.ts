/**
 * 单价条形图几何单测(M74 批G):每模型最便宜一家、币种×单位分区、
 * 0 价不入图、条长线性归一、行数截断。
 */
import { describe, expect, it } from "vitest";

import {
  buildUnitPriceBars,
  UNIT_BARS_MAX_ROWS,
  unitBarsCanvasWidth,
  UNIT_BARS_LABEL_W,
  UNIT_BARS_MAX_W,
  UNIT_BARS_PRICE_W,
} from "./bars";
import type { PublicModelRow } from "./public";

function row(over: Partial<PublicModelRow>): PublicModelRow {
  return {
    vendor: "V",
    modelKey: "m",
    currency: "CNY",
    inputPrice: 1,
    outputPrice: 2,
    freeTier: null,
    isFree: false,
    contextWindow: null,
    note: null,
    dataAsOf: "2026-11-17",
    sourceUrl: "https://x",
    region: "cn",
    providerKey: null,
    providerName: null,
    providerKind: null,
    modelDictKey: null,
    modality: "image",
    priceUnit: "per_image",
    protocols: [],
    tiers: [],
    ...over,
  };
}

describe("buildUnitPriceBars", () => {
  it("token 行不进条形图(散点管),非 token 行进", () => {
    const groups = buildUnitPriceBars([
      row({ modelDictKey: "img", outputPrice: 0.2 }),
      row({ modelDictKey: "llm", priceUnit: "per_1m_tokens", inputPrice: 1, outputPrice: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.bars.map((b) => b.displayName)).toEqual(["img"]);
  });

  it("每模型取最便宜一家;0 价(完全免费)不入图计 skipped", () => {
    const groups = buildUnitPriceBars([
      row({ modelDictKey: "a", providerKey: "p1", providerName: "P1", outputPrice: 0.3 }),
      row({ modelDictKey: "a", providerKey: "p2", providerName: "P2", outputPrice: 0.15 }),
      row({ modelDictKey: "free", outputPrice: 0, isFree: true }),
    ]);
    expect(groups).toHaveLength(1);
    const bar = groups[0]!.bars.find((b) => b.displayName === "a")!;
    expect(bar.price).toBe(0.15);
    expect(bar.providerName).toBe("P2");
    expect(groups[0]!.skipped).toBe(1);
  });

  it("币种 × 单位分区:元/张与元/秒各一块,互不混", () => {
    const groups = buildUnitPriceBars([
      row({ modelDictKey: "i", priceUnit: "per_image", outputPrice: 0.2 }),
      row({ modelDictKey: "v", priceUnit: "per_second", outputPrice: 0.5 }),
      row({ modelDictKey: "i-usd", priceUnit: "per_image", currency: "USD", outputPrice: 0.1 }),
    ]);
    expect(groups).toHaveLength(3);
    expect(new Set(groups.map((g) => `${g.currency}|${g.priceUnit}`))).toEqual(
      new Set(["CNY|per_image", "CNY|per_second", "USD|per_image"]),
    );
    expect(
      groups.find((g) => g.priceUnit === "per_image" && g.currency === "CNY")!.unitSuffix,
    ).toBe("/张");
  });

  it("条长按组内最大价线性归一,升序排列", () => {
    const groups = buildUnitPriceBars([
      row({ modelDictKey: "big", outputPrice: 0.8 }),
      row({ modelDictKey: "small", outputPrice: 0.2 }),
    ]);
    const bars = groups[0]!.bars;
    expect(bars.map((b) => b.displayName)).toEqual(["small", "big"]);
    expect(bars[1]!.width).toBeGreaterThan(bars[0]!.width);
  });

  it("超出上限截断(按价升序留最便宜的)", () => {
    const rows = Array.from({ length: UNIT_BARS_MAX_ROWS + 5 }, (_, i) =>
      row({ modelDictKey: `m-${i}`, outputPrice: 0.01 * (i + 1) }),
    );
    const bars = buildUnitPriceBars(rows)[0]!.bars;
    expect(bars).toHaveLength(UNIT_BARS_MAX_ROWS);
    expect(bars.at(-1)!.displayName).toBe(`m-${UNIT_BARS_MAX_ROWS - 1}`);
  });
});

describe("画布尺寸(2026-11-18 修:条顶出画布/价格标签不可见/SVG 被放大)", () => {
  it("画布宽 = 标签区 + 最大条长 + 价格标注区(不是最大行数)", () => {
    expect(unitBarsCanvasWidth()).toBe(UNIT_BARS_LABEL_W + UNIT_BARS_MAX_W + UNIT_BARS_PRICE_W);
    expect(unitBarsCanvasWidth()).toBeGreaterThan(UNIT_BARS_MAX_W);
  });

  it("最长条 + 其右侧价格文本整条落在画布内", () => {
    const w = unitBarsCanvasWidth();
    const barRight = UNIT_BARS_LABEL_W + UNIT_BARS_MAX_W; // 条右沿
    const priceTextX = barRight + 8; // 价格文本起点(渲染处 barX + width + 8)
    expect(barRight).toBeLessThan(w);
    expect(priceTextX + 60).toBeLessThanOrEqual(w); // 价格文本宽约 60
  });
});
