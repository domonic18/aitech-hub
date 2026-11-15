/**
 * /pricing/ 筛选态 ⇄ URL 编解码单测(M74 批C):非法值回落默认、
 * 默认态不产参数、往返一致、前进后退可判等价。
 */
import { describe, expect, it } from "vitest";

import {
  decodePricingQuery,
  DEFAULT_PRICING_QUERY,
  encodePricingQuery,
  isDefaultPricingQuery,
  samePricingQuery,
} from "./query";

describe("decodePricingQuery", () => {
  it("空串 → 默认态", () => {
    expect(decodePricingQuery("")).toEqual(DEFAULT_PRICING_QUERY);
  });

  it("逐项解析", () => {
    const q = decodePricingQuery(
      "v=阿里云百炼,腾讯云&b=lt10&free=1&mod=text&ctx=ge1m&src=official&sort=input",
    );
    expect(q.vendors).toEqual(["阿里云百炼", "腾讯云"]);
    expect(q.band).toBe("lt10");
    expect(q.freeOnly).toBe(true);
    expect(q.modality).toBe("text");
    expect(q.contextBand).toBe("ge1m");
    expect(q.sourceKind).toBe("official");
    expect(q.sort).toBe("input");
  });

  it("非法值一律回落默认(URL 是用户可手改的,不能崩)", () => {
    const q = decodePricingQuery("b=not-a-band&ctx=xx&sort=zzz&free=yes");
    expect(q.band).toBe("all");
    expect(q.contextBand).toBe("all");
    expect(q.sort).toBe("default");
    expect(q.freeOnly).toBe(false);
  });

  it("厂商去重去空", () => {
    const q = decodePricingQuery("v=a,,a,%20b%20");
    expect(q.vendors).toEqual(["a", "b"]);
  });
});

describe("encodePricingQuery", () => {
  it("默认态 → 空串(URL 保持干净)", () => {
    expect(encodePricingQuery(DEFAULT_PRICING_QUERY)).toBe("");
    expect(isDefaultPricingQuery(DEFAULT_PRICING_QUERY)).toBe(true);
  });

  it("往返一致", () => {
    const state = {
      vendors: ["硅基流动 SiliconFlow"],
      band: "lt10" as const,
      freeOnly: true,
      modality: "text",
      contextBand: "ge128k" as const,
      sourceKind: "aggregator",
      sort: "output" as const,
    };
    expect(decodePricingQuery(encodePricingQuery(state))).toEqual(state);
  });
});

describe("samePricingQuery", () => {
  it("等价判定(含厂商顺序)", () => {
    const a = { ...DEFAULT_PRICING_QUERY, vendors: ["a", "b"] };
    expect(samePricingQuery(a, { ...DEFAULT_PRICING_QUERY, vendors: ["a", "b"] })).toBe(true);
    expect(samePricingQuery(a, { ...DEFAULT_PRICING_QUERY, vendors: ["b", "a"] })).toBe(false);
    expect(samePricingQuery(a, { ...DEFAULT_PRICING_QUERY, vendors: ["a"] })).toBe(false);
  });
});
