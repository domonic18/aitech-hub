/**
 * 牌价比价装配单测(M74 批D):跨厂商聚合 / 最低价高亮 / 币种分区 /
 * null 价不参与比较;散点几何(对数轴、0 价跳过、每模型一点)。
 */
import { describe, expect, it } from "vitest";

import { buildCompareGroups, compareKeyOf, countComparableModels } from "./compare";
import { buildPriceScatter } from "./scatter";
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
    dataAsOf: "2026-11-15",
    sourceUrl: "https://x",
    region: "cn",
    providerKey: null,
    providerName: null,
    providerKind: null,
    modelDictKey: null,
    modality: null,
    priceUnit: "per_1m_tokens",
    protocols: [],
    tiers: [],
    ...over,
  };
}

describe("buildCompareGroups", () => {
  it("同一模型跨提供商聚成一行;单家报价的模型不进矩阵", () => {
    const rows = [
      row({
        modelKey: "qwen3-max",
        modelDictKey: "qwen3-max",
        providerKey: "aliyun-bailian",
        inputPrice: 12,
      }),
      row({
        modelKey: "qwen3-max",
        modelDictKey: "qwen3-max",
        providerKey: "siliconflow",
        inputPrice: 9,
      }),
      row({ modelKey: "solo", providerKey: "aliyun-bailian", inputPrice: 3 }),
    ];
    const groups = buildCompareGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.models).toHaveLength(1);
    expect(groups[0]!.models[0]!.providerCount).toBe(2);
    expect(countComparableModels(rows)).toBe(1);
  });

  it("最低价标在输入价最小的一家;同价比输出价", () => {
    const rows = [
      row({ modelDictKey: "m", providerKey: "a", inputPrice: 5, outputPrice: 20 }),
      row({ modelDictKey: "m", providerKey: "b", inputPrice: 3, outputPrice: 30 }),
      row({ modelDictKey: "m", providerKey: "c", inputPrice: 3, outputPrice: 10 }),
    ];
    const model = buildCompareGroups(rows)[0]!.models[0]!;
    expect(model.cheapestProviderKey).toBe("c");
  });

  it("未公布价(null)不参与比较,不当作最便宜", () => {
    const rows = [
      row({ modelDictKey: "m", providerKey: "a", inputPrice: null, outputPrice: null }),
      row({ modelDictKey: "m", providerKey: "b", inputPrice: 4, outputPrice: 8 }),
    ];
    const model = buildCompareGroups(rows)[0]!.models[0]!;
    expect(model.cheapestProviderKey).toBe("b");
  });

  it("批G:跨计价单位不比——token 价与按张价各归各区,各自区内才比", () => {
    const rows = [
      row({
        modelDictKey: "img",
        providerKey: "a",
        priceUnit: "per_image",
        inputPrice: null,
        outputPrice: 0.25,
      }),
      row({
        modelDictKey: "img",
        providerKey: "b",
        priceUnit: "per_image",
        inputPrice: null,
        outputPrice: 0.18,
      }),
      row({ modelDictKey: "m", providerKey: "a", priceUnit: "per_1m_tokens", inputPrice: 5 }),
      row({
        modelDictKey: "m",
        providerKey: "b",
        priceUnit: "per_image",
        inputPrice: null,
        outputPrice: 0.2,
      }),
    ];
    const groups = buildCompareGroups(rows);
    // img 两家按张价同区可比;token/按张混报价的 m 不可比(各单家)
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.priceUnit).toBe("per_image");
    const img = g.models[0]!;
    expect(img.cheapestProviderKey).toBe("b"); // 生成价 0.18 < 0.25
    expect(countComparableModels(rows)).toBe(1);
  });

  it("按**单元格**币种分区:同一模型的 CNY/USD 报价各归各区,区内才比价", () => {
    const rows = [
      row({ modelDictKey: "m", providerKey: "a", currency: "CNY", inputPrice: 5 }),
      row({ modelDictKey: "m", providerKey: "b", currency: "USD", inputPrice: 1 }),
    ];
    const groups = buildCompareGroups(rows);
    // 每区只有一个报价家 → 谁也不可比价 → 不产出任何区
    expect(groups).toHaveLength(0);
  });

  it("同区内两家同币种才可比价并标最低", () => {
    const rows = [
      row({ modelDictKey: "m", providerKey: "a", currency: "CNY", inputPrice: 5 }),
      row({ modelDictKey: "m", providerKey: "b", currency: "CNY", inputPrice: 2 }),
      row({ modelDictKey: "m", providerKey: "c", currency: "USD", inputPrice: 1 }),
    ];
    const groups = buildCompareGroups(rows);
    expect(groups).toHaveLength(1);
    const cny = groups.find((g) => g.currency === "CNY")!;
    expect(cny.models).toHaveLength(1);
    expect(cny.models[0]!.cheapestProviderKey).toBe("b");
    expect(cny.models[0]!.providerCount).toBe(2);
  });

  it("同一提供商多行取输入价最低的一条为代表", () => {
    const rows = [
      row({ modelDictKey: "m", providerKey: "a", inputPrice: 9 }),
      row({ modelDictKey: "m", providerKey: "a", inputPrice: 4 }),
    ];
    const groups = buildCompareGroups(rows);
    // 同一家不构成「两家报价」→ 不进矩阵
    expect(groups).toHaveLength(0);
  });

  it("归一键优先用模型字典键(跨厂商同一模型聚一起)", () => {
    expect(compareKeyOf(row({ modelKey: "org/Model", modelDictKey: "model" }))).toBe("model");
    expect(compareKeyOf(row({ modelKey: "org/Model" }))).toBe("org/Model");
  });
});

describe("buildPriceScatter", () => {
  it("每个模型一点(取最便宜的一家);对数轴映射落在绘图区内", () => {
    const rows = [
      row({ modelDictKey: "m1", providerKey: "a", inputPrice: 1, outputPrice: 4 }),
      row({ modelDictKey: "m1", providerKey: "b", inputPrice: 2, outputPrice: 8 }),
      row({ modelDictKey: "m2", providerKey: "a", inputPrice: 10, outputPrice: 40 }),
    ];
    const geo = buildPriceScatter(rows);
    expect(geo.points).toHaveLength(2);
    for (const p of geo.points) {
      expect(p.x).toBeGreaterThanOrEqual(geo.plot.left);
      expect(p.x).toBeLessThanOrEqual(geo.plot.right);
      expect(p.y).toBeGreaterThanOrEqual(geo.plot.top);
      expect(p.y).toBeLessThanOrEqual(geo.plot.bottom);
    }
    // m1 取最便宜的一家
    expect(geo.points.find((p) => p.modelKey === "m1")!.providerKey).toBe("a");
  });

  it("0 价(完全免费)不入图,计入 skipped", () => {
    const rows = [
      row({ modelDictKey: "free", inputPrice: 0, outputPrice: 0 }),
      row({ modelDictKey: "paid", inputPrice: 2, outputPrice: 6 }),
    ];
    const geo = buildPriceScatter(rows);
    expect(geo.points).toHaveLength(1);
    expect(geo.skipped).toBe(1);
  });

  it("全 0 价时给空图(不崩)", () => {
    const geo = buildPriceScatter([row({ inputPrice: 0, outputPrice: 0 })]);
    expect(geo.points).toHaveLength(0);
    expect(geo.skipped).toBe(1);
  });
});

describe("批D8:点数上限截断", () => {
  it("散点超过 300 点按输入价升序保留最便宜的,truncated 记截断数", () => {
    const rows = Array.from({ length: 320 }, (_, i) =>
      row({ modelDictKey: `m${i}`, providerKey: "a", inputPrice: 1 + i, outputPrice: 2 + i }),
    );
    const geo = buildPriceScatter(rows);
    expect(geo.points).toHaveLength(300);
    expect(geo.truncated).toBe(20);
    // 保留的是最便宜的前 300 个(输入价 1..300)
    const inputs = geo.points.map((p) => p.input).sort((a, b) => a - b);
    expect(inputs[0]).toBe(1);
    expect(inputs.at(-1)).toBe(300);
  });

  it("散点未超上限时 truncated=0(现网 300 行量级无感)", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row({ modelDictKey: `m${i}`, providerKey: "a", inputPrice: 1 + i, outputPrice: 2 + i }),
    );
    const geo = buildPriceScatter(rows);
    expect(geo.truncated).toBe(0);
    expect(geo.points).toHaveLength(50);
  });

  it("比价每币种×单位区最多 50 个模型,截掉的是更贵的", () => {
    const rows = Array.from({ length: 55 }, (_, i) => [
      row({ modelDictKey: `m${i}`, providerKey: "a", inputPrice: 1 + i }),
      row({ modelDictKey: `m${i}`, providerKey: "b", inputPrice: 2 + i }),
    ]).flat();
    const groups = buildCompareGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.models).toHaveLength(50);
    expect(groups[0]!.truncated).toBe(5);
    // 保留的是代表价升序的前 50(m0..m49)
    expect(groups[0]!.models[0]!.key).toBe("m0");
    expect(groups[0]!.models.at(-1)!.key).toBe("m49");
  });
});
