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

  it("逐项解析(批G:cat 取代 mod,默认 text)", () => {
    const q = decodePricingQuery(
      "v=阿里云百炼,腾讯云&b=lt10&free=quota&cat=image&ctx=ge1m&src=official&sort=input",
    );
    expect(q.vendors).toEqual(["阿里云百炼", "腾讯云"]);
    expect(q.band).toBe("lt10");
    expect(q.freeScope).toBe("quota");
    expect(q.cat).toBe("image");
    expect(q.contextBand).toBe("ge1m");
    expect(q.sourceKind).toBe("official");
    expect(q.sort).toBe("input");
  });

  it("免费口径四态可解析;旧值 free=1 按「完全免费」承接(老链接不失效)", () => {
    expect(decodePricingQuery("free=full").freeScope).toBe("full");
    expect(decodePricingQuery("free=quota").freeScope).toBe("quota");
    expect(decodePricingQuery("free=any").freeScope).toBe("any");
    expect(decodePricingQuery("free=1").freeScope).toBe("full");
    expect(decodePricingQuery("free=all").freeScope).toBe("all");
  });

  it("旧 mod 参数映射到 cat 后丢弃(批C 外链兼容)", () => {
    expect(decodePricingQuery("mod=image").cat).toBe("image");
    expect(decodePricingQuery("mod=embedding").cat).toBe("vector");
    expect(decodePricingQuery("mod=text+vision").cat).toBe("text");
    // cat 显式给定时 mod 不覆盖
    expect(decodePricingQuery("cat=video&mod=image").cat).toBe("video");
  });

  it("场景价 scn 编解码(P4)", () => {
    expect(decodePricingQuery("").scenario).toBe("off");
    expect(decodePricingQuery("scn=text-1M-tokens").scenario).toBe("text-1M-tokens");
    expect(decodePricingQuery("scn=bad").scenario).toBe("off");
    expect(encodePricingQuery({ ...DEFAULT_PRICING_QUERY, scenario: "image-100-images-1K" })).toBe(
      "scn=image-100-images-1K",
    );
  });

  it("非法值一律回落默认(URL 是用户可手改的,不能崩)", () => {
    const q = decodePricingQuery("b=not-a-band&ctx=xx&sort=zzz&free=yes&scn=bad");
    expect(q.band).toBe("all");
    expect(q.contextBand).toBe("all");
    expect(q.sort).toBe("default");
    expect(q.freeScope).toBe("all");
    expect(q.scenario).toBe("off");
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

  it("view 参数编解码(比价视图可分享)", () => {
    expect(decodePricingQuery("view=compare").view).toBe("compare");
    expect(decodePricingQuery("view=xxx").view).toBe("list");
    expect(encodePricingQuery({ ...DEFAULT_PRICING_QUERY, view: "compare" })).toBe("view=compare");
  });

  it("页内大页签 panel:默认 model;plan 可分享直达,非法值回落 model", () => {
    expect(decodePricingQuery("").panel).toBe("model");
    expect(decodePricingQuery("panel=plan").panel).toBe("plan");
    expect(decodePricingQuery("panel=xxx").panel).toBe("model");
    expect(encodePricingQuery({ ...DEFAULT_PRICING_QUERY, panel: "plan" })).toBe("panel=plan");
    expect(encodePricingQuery(DEFAULT_PRICING_QUERY)).toBe(""); // 默认不产参数
  });

  it("往返一致", () => {
    const state = {
      vendors: ["硅基流动 SiliconFlow"],
      band: "lt10" as const,
      freeScope: "quota" as const,
      cat: "image" as const,
      contextBand: "ge128k" as const,
      sourceKind: "aggregator",
      sort: "output" as const,
      view: "compare" as const,
      panel: "plan" as const,
      scenario: "text-1M-tokens" as const,
      q: "",
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
