/**
 * 场景价单测(P4):不同计价单位按固定 workload 归一。
 */
import { describe, expect, it } from "vitest";

import { formatScenarioCost, normalizeScenarioId, scenarioCost, scenarioOptions } from "./scenario";

function row(
  over: Partial<{ priceUnit: string; inputPrice: number | null; outputPrice: number | null }>,
) {
  return {
    priceUnit: "per_1m_tokens",
    inputPrice: null,
    outputPrice: null,
    ...over,
  };
}

describe("normalizeScenarioId", () => {
  it("合法值原样返回,非法/空值回落 off", () => {
    expect(normalizeScenarioId("text-1M-tokens")).toBe("text-1M-tokens");
    expect(normalizeScenarioId("bad")).toBe("off");
    expect(normalizeScenarioId(null)).toBe("off");
  });
});

describe("scenarioCost", () => {
  it("off 或未选 → null", () => {
    expect(scenarioCost(row({ inputPrice: 1, outputPrice: 2 }), "off")).toBeNull();
  });

  it("文本 1M tokens:按 input/output 各 50 万计", () => {
    expect(scenarioCost(row({ inputPrice: 1, outputPrice: 2 }), "text-1M-tokens")).toBe(
      (1 * 500_000 + 2 * 500_000) / 1_000_000,
    );
  });

  it("按张:outputPrice × 100", () => {
    expect(
      scenarioCost(row({ priceUnit: "per_image", outputPrice: 0.5 }), "image-100-images-1K"),
    ).toBe(50);
  });

  it("按秒:outputPrice × 10", () => {
    expect(
      scenarioCost(row({ priceUnit: "per_second", outputPrice: 0.3 }), "video-10s-1080P"),
    ).toBe(3);
  });

  it("按分钟:先换算成秒再 × 10", () => {
    expect(scenarioCost(row({ priceUnit: "per_minute", outputPrice: 60 }), "video-10s-1080P")).toBe(
      10,
    );
  });

  it("不兼容单位或缺价 → null", () => {
    expect(scenarioCost(row({ priceUnit: "per_image" }), "text-1M-tokens")).toBeNull();
    expect(scenarioCost(row({ priceUnit: "per_1m_tokens" }), "image-100-images-1K")).toBeNull();
    expect(
      scenarioCost(row({ priceUnit: "per_second", outputPrice: null }), "video-10s-1080P"),
    ).toBeNull();
  });
});

describe("formatScenarioCost", () => {
  it("带币种与场景后缀;null 显示 —", () => {
    expect(formatScenarioCost(12.5, "CNY", "image-100-images-1K")).toBe("¥ 12.5/100张");
    expect(formatScenarioCost(0.8, "USD", "text-1M-tokens")).toBe("$ 0.8/1M tokens");
    expect(formatScenarioCost(null, "CNY", "text-1M-tokens")).toBe("—");
  });
});

describe("scenarioOptions", () => {
  it("包含 off 与三个场景", () => {
    const ids = scenarioOptions().map((o) => o.id);
    expect(ids).toEqual(["off", "text-1M-tokens", "image-100-images-1K", "video-10s-1080P"]);
  });
});
