/**
 * 用量看板聚合单测(M14 批⑦):窗口起点 CN 日界、费用口径(LLM tokens/ASR 按秒/
 * 生图按张/failed 不计费/未定价 0)、降级与 ASR KPI 分账、CN 日桶、明细 spark 桶。
 */
import { describe, expect, it } from "vitest";

import {
  aggregateUsage,
  costOfRow,
  sparkTrend,
  usageWindowSince,
  type UsageRowLike,
} from "./usage-queries";

/** 固定「现在」:2026-10-06 12:00 UTC(北京 20:00) */
const NOW = new Date("2026-10-06T12:00:00Z");

function row(over: Partial<UsageRowLike>): UsageRowLike {
  return {
    role: "interpret",
    modelId: 1,
    modelKey: "deepseek-chat",
    tokensIn: 0,
    tokensOut: 0,
    audioSeconds: 0,
    status: "ok",
    createdAt: NOW,
    ...over,
  };
}

const PRICES = {
  models: new Map([[1, { priceIn: 2, priceOut: 8, pricePerImage: 0.5 }]]),
  asrPricePerHour: 10,
};

describe("usageWindowSince", () => {
  it("起点=窗口最旧一天的北京零点(UTC 16:00 前一天)", () => {
    // 最旧一天=北京 09-30,其零点即 UTC 09-29T16:00
    expect(usageWindowSince(NOW, 7).toISOString()).toBe("2026-09-29T16:00:00.000Z");
    expect(usageWindowSince(NOW, 1).toISOString()).toBe("2026-10-05T16:00:00.000Z");
  });
});

describe("costOfRow", () => {
  it("LLM 行 = in×入价 + out×出价(¥/1M)", () => {
    expect(costOfRow(row({ tokensIn: 1_000_000, tokensOut: 500_000 }), PRICES)).toBeCloseTo(6);
  });
  it("ASR 行按音频秒比例折时价;降级(终败)不计费", () => {
    expect(costOfRow(row({ role: "asr", modelId: null, audioSeconds: 1800 }), PRICES)).toBeCloseTo(
      5,
    );
    expect(costOfRow(row({ role: "asr", modelId: null, status: "degraded" }), PRICES)).toBe(0);
  });
  it("cover 行按张计费(每行一张);failed 行一律 0;未定价 0", () => {
    expect(costOfRow(row({ role: "cover" }), PRICES)).toBeCloseTo(0.5);
    expect(costOfRow(row({ status: "failed", tokensIn: 1e9 }), PRICES)).toBe(0);
    expect(costOfRow(row({ modelId: 99 }), PRICES)).toBe(0);
  });
});

describe("aggregateUsage", () => {
  it("KPI 分账:tokens/费用/ASR 时长个数/降级拆分;CN 日桶落账;窗口外行不计", () => {
    const rows = [
      row({ tokensIn: 2_000_000, tokensOut: 1_000_000 }), // 3M tokens,¥12
      row({ role: "summarize", modelKey: "glm-5", modelId: 1, tokensIn: 1_000_000 }), // ¥2
      row({ role: "asr", modelId: null, audioSeconds: 3600, status: "ok" }), // 1h ¥10
      row({ role: "asr", modelId: null, status: "degraded" }), // 降级,不计时长
      row({ role: "cover", modelId: 1 }), // ¥0.5
      row({ role: "interpret", modelId: 1, status: "degraded" }), // LLM 降级(备用)
      row({ tokensIn: 1e9, createdAt: new Date("2026-09-01T00:00:00Z") }), // 窗口外
    ];
    const o = aggregateUsage(rows, PRICES, { days: 7, now: NOW, prevTokens: 1_000_000 });
    expect(o.kpi.tokens).toBe(4_000_000);
    expect(o.kpi.prevTokens).toBe(1_000_000);
    expect(o.kpi.cost).toBeCloseTo(24.5);
    expect(o.kpi.asrHours).toBeCloseTo(1);
    expect(o.kpi.asrCount).toBe(1);
    expect(o.kpi.asrCost).toBeCloseTo(10);
    expect(o.kpi.degradedAsr).toBe(1);
    expect(o.kpi.degradedLlm).toBe(1);
    expect(o.daily).toHaveLength(7);
    expect(o.daily[6]!.date).toBe("2026-10-06");
    expect(o.daily[6]!.tokens).toBe(4_000_000);
    expect(o.byRole.map((r) => r.key)).toEqual(["interpret", "summarize", "asr", "cover"]);
    expect(o.byModel.map((r) => r.key)).toEqual(["deepseek-chat", "glm-5"]);
  });

  it("明细按 (role, modelKey) 归组、tokens 降序,spark 14 桶", () => {
    const rows = [
      row({ tokensIn: 100 }),
      row({ tokensIn: 200 }),
      row({ role: "cover", modelId: 1 }),
    ];
    const o = aggregateUsage(rows, PRICES, { days: 7, now: NOW, prevTokens: 0 });
    expect(o.rows).toHaveLength(2);
    expect(o.rows[0]).toMatchObject({ role: "interpret", modelKey: "deepseek-chat", calls: 2 });
    expect(o.rows[0]!.spark).toHaveLength(14);
    expect(o.rows[1]!.role).toBe("cover");
  });
});

describe("sparkTrend", () => {
  it("窗口外桶丢弃,等宽 14 桶计数", () => {
    const since = usageWindowSince(NOW, 7);
    const mid = new Date(since.getTime() + 3.5 * 86_400_000);
    const buckets = sparkTrend(
      [row({ tokensIn: 10, createdAt: mid }), row({ tokensIn: 99, createdAt: new Date(0) })],
      since,
      NOW.getTime(),
    );
    expect(buckets).toHaveLength(14);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(10);
    expect(buckets[7]).toBe(10); // 3.5/6.83 窗口 → 第 7 桶
  });
});
