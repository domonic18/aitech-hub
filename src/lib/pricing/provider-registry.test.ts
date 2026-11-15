/**
 * 牌价厂商字典单测(M74 批A):vendor 字符串 → 规范键的映射。
 * 认不出返回 null(猜错厂商比不归一更糟)。
 */
import { describe, expect, it } from "vitest";

import { PROVIDER_SEEDS, providerKeyForVendor } from "./provider-registry";

describe("providerKeyForVendor", () => {
  it("采集器写死的 vendor 字符串逐条命中别名表", () => {
    expect(providerKeyForVendor("DeepSeek 深度求索")).toBe("deepseek");
    expect(providerKeyForVendor("月之暗面 Moonshot")).toBe("moonshot");
    expect(providerKeyForVendor("月之暗面 Kimi")).toBe("moonshot");
    expect(providerKeyForVendor("阿里云百炼")).toBe("aliyun-bailian");
    expect(providerKeyForVendor("腾讯云")).toBe("tencent-cloud");
    expect(providerKeyForVendor("小米 MiMo")).toBe("xiaomi-mimo");
    expect(providerKeyForVendor("MiniMax 稀宇科技")).toBe("minimax");
    expect(providerKeyForVendor("智谱 AI · BigModel")).toBe("zhipu-bigmodel");
  });

  it("同厂商两种写法归到同一键(这正是要归一的原因)", () => {
    expect(providerKeyForVendor("月之暗面 Moonshot")).toBe(providerKeyForVendor("月之暗面 Kimi"));
  });

  it("认不出的厂商返回 null(不猜)", () => {
    expect(providerKeyForVendor("某野牌厂商")).toBeNull();
    expect(providerKeyForVendor("")).toBeNull();
  });
});

describe("PROVIDER_SEEDS", () => {
  it("规范键唯一", () => {
    const keys = PROVIDER_SEEDS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("别名表指向的键都在种子里(采集侧改了 vendor 字符串要同步这里)", () => {
    const keys = new Set(PROVIDER_SEEDS.map((s) => s.key));
    for (const seed of PROVIDER_SEEDS) expect(keys.has(seed.key)).toBe(true);
  });

  it("聚合平台标 aggregator、一手厂商标 official", () => {
    const agg = PROVIDER_SEEDS.filter((s) => s.sourceKind === "aggregator").map((s) => s.key);
    expect(agg).toContain("baidu-ciyuansuo");
    expect(agg).toContain("siliconflow");
    expect(PROVIDER_SEEDS.find((s) => s.key === "deepseek")?.sourceKind).toBe("official");
  });
});
