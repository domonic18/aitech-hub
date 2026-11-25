/**
 * 采集侧行组装单测(P2 收尾):验证原始记录 → ModelPrefillRow 的公共路径。
 */
import { describe, expect, it } from "vitest";

import { assembleModelPrefillRows, defaultTierLabelOf, type RawPricingRecord } from "./assemble";

const opts = {
  vendor: "测试厂商",
  currency: "CNY" as const,
  sourceUrl: "https://example.com/pricing",
  region: "cn" as const,
  unit: "per_1m_tokens",
  dataAsOf: new Date("2026-11-25"),
  providerKey: "test",
};

function one<T>(arr: T[]): T {
  expect(arr).toHaveLength(1);
  return arr[0] as T;
}

function firstTier(row: { tiers?: { tierLabel: string }[] }): { tierLabel: string } {
  expect(row.tiers?.length).toBeGreaterThan(0);
  return row.tiers![0] as { tierLabel: string };
}

describe("defaultTierLabelOf", () => {
  it("拼接 scope·mode·cond·tokenRange", () => {
    expect(defaultTierLabelOf({ modelKey: "x", scope: "全球", mode: "常规" })).toBe("常规");
    expect(defaultTierLabelOf({ modelKey: "x", mode: "常规", tokenRange: "[0,32K)" })).toBe(
      "常规·[0,32K)",
    );
    expect(defaultTierLabelOf({ modelKey: "x", cond: "720P" })).toBe("720P");
    expect(defaultTierLabelOf({ modelKey: "x" })).toBe("默认");
  });
});

describe("assembleModelPrefillRows", () => {
  it("token 系:多条记录聚成档位,行价取「全球」档", () => {
    const recs: RawPricingRecord[] = [
      { modelKey: "qwen3", scope: "美国", input: 1, output: 2, tokenRange: "≤8K" },
      { modelKey: "qwen3", scope: "全球", input: 0.8, output: 1.5, tokenRange: "≤8K" },
    ];
    const rows = assembleModelPrefillRows(recs, opts);
    const row = one(rows);
    expect(row.modelKey).toBe("qwen3");
    expect(row.inputPrice).toBe(0.8);
    expect(row.outputPrice).toBe(1.5);
    expect(row.tiers).toHaveLength(2);
  });

  it("模态计价:按最低分辨率档取行价", () => {
    const recs: RawPricingRecord[] = [
      { modelKey: "kling-v3", cond: "1080P", output: 2 },
      { modelKey: "kling-v3", cond: "720P", output: 1 },
    ];
    const rows = assembleModelPrefillRows(recs, { ...opts, unit: "per_second" });
    const row = one(rows);
    expect(row.outputPrice).toBe(1);
    expect(firstTier(row).tierLabel).toBe("1080P");
  });

  it("combined 列:输入输出同价", () => {
    const recs: RawPricingRecord[] = [{ modelKey: "vidu", cond: "480P", combined: 0.5 }];
    const rows = assembleModelPrefillRows(recs, { ...opts, unit: "per_second" });
    const row = one(rows);
    expect(row.inputPrice).toBe(0.5);
    expect(row.outputPrice).toBe(0.5);
  });

  it("同名同价去重,同名不同价加序号", () => {
    const recs: RawPricingRecord[] = [
      { modelKey: "m", cond: "720P", output: 1 },
      { modelKey: "m", cond: "720P", output: 1 },
      { modelKey: "m", cond: "720P", output: 2 },
    ];
    const rows = assembleModelPrefillRows(recs, { ...opts, unit: "per_second" });
    const row = one(rows);
    expect(row.tiers!).toHaveLength(2);
    expect(row.tiers!.map((t) => t.tierLabel)).toEqual(["720P", "720P·2"]);
  });

  it("免费额度写入 freeTier 与 note", () => {
    const recs: RawPricingRecord[] = [
      { modelKey: "m", input: 1, output: 2, free: "每日 100 万 tokens 免费" },
    ];
    const rows = assembleModelPrefillRows(recs, opts);
    const row = one(rows);
    expect(row.freeTier).toBe("每日 100 万 tokens 免费");
    expect(row.note).toBe("每日 100 万 tokens 免费");
  });
});
