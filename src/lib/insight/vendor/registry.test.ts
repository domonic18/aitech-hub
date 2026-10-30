/** 厂商注册表 ↔ 洞察源注册表一致性单测(M58 批②):单一真相源不许漂。 */
import { describe, expect, it } from "vitest";

import { INSIGHT_SOURCE_MEDIUM, SOURCE_REGISTRY } from "../source-registry";

import { VENDOR_DEFS, VENDOR_MAX_ITEMS, resolveVendorDef } from "./registry";

describe("VENDOR_DEFS", () => {
  it("首批六家厂商且 key 唯一", () => {
    const keys = VENDOR_DEFS.map((d) => d.key);
    expect(keys).toEqual(["openai", "anthropic", "google", "deepseek", "qwen", "kimi"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("insightSource 均在 SOURCE_REGISTRY 登记、在役、介质 ai-record", () => {
    for (const def of VENDOR_DEFS) {
      const row = SOURCE_REGISTRY[def.insightSource];
      expect(row, def.key).toBeDefined();
      expect(row.enabled, def.key).toBe(true);
      expect(INSIGHT_SOURCE_MEDIUM[def.insightSource]).toBe("ai-record");
    }
  });

  it("config.vendorKey 路由;未注册 key 返回 null;单轮上限 20", () => {
    expect(resolveVendorDef({ vendorKey: "openai" })?.key).toBe("openai");
    expect(resolveVendorDef({ vendorKey: "nope" })).toBeNull();
    expect(resolveVendorDef(null)).toBeNull();
    expect(resolveVendorDef("openai")).toBeNull();
    expect(VENDOR_MAX_ITEMS).toBe(20);
  });
});
