/**
 * 源↔行解析单测(M79):providerKey 优先、vendor 兜底、产出面隔离。
 */
import { describe, expect, it } from "vitest";

import { buildPricingSourceResolver, type ResolvableSource } from "./source-resolve";

const sources: ResolvableSource[] = [
  { key: "baidu-ciyuansuo", vendor: "百度词元所", target: "model", providerKey: "baidu-ciyuansuo" },
  { key: "tencent-hunyuan", vendor: "腾讯云", target: "model", providerKey: "tencent-cloud" },
  { key: "tencent-tokenplan", vendor: "腾讯云", target: "plan", providerKey: "tencent-cloud" },
  { key: "kimi-membership", vendor: "月之暗面 Kimi", target: "plan", providerKey: "moonshot" },
];

describe("buildPricingSourceResolver", () => {
  it("聚合行(providerKey 连源,vendor 对不上)→ 命中自己的源", () => {
    const resolve = buildPricingSourceResolver(sources);
    const hit = resolve({ vendor: "词元所·可灵 AI", providerKey: "baidu-ciyuansuo" });
    expect(hit?.key).toBe("baidu-ciyuansuo");
  });

  it("同 providerKey 的兄弟源靠产出面分开(腾讯云模型 vs 套餐)", () => {
    const resolve = buildPricingSourceResolver(sources);
    expect(resolve({ vendor: "腾讯云", providerKey: "tencent-cloud", target: "model" })?.key).toBe(
      "tencent-hunyuan",
    );
    expect(resolve({ vendor: "腾讯云", providerKey: "tencent-cloud", target: "plan" })?.key).toBe(
      "tencent-tokenplan",
    );
  });

  it("providerKey 缺失(未归一/手建行)→ vendor 精确匹配兜底;缺省产出面按 model", () => {
    const resolve = buildPricingSourceResolver(sources);
    expect(resolve({ vendor: "百度词元所" })?.key).toBe("baidu-ciyuansuo");
    expect(resolve({ vendor: "月之暗面 Kimi", target: "plan" })?.key).toBe("kimi-membership");
    expect(resolve({ vendor: "月之暗面 Kimi" })).toBeUndefined();
  });

  it("providerKey 命不中时回落 vendor(归一键与源都存在但键不同也不死锁)", () => {
    const resolve = buildPricingSourceResolver(sources);
    expect(resolve({ vendor: "腾讯云", providerKey: "unknown-key", target: "model" })?.key).toBe(
      "tencent-hunyuan",
    );
  });

  it("两级都 miss → undefined(闸门拒/计数不计,如实处理)", () => {
    const resolve = buildPricingSourceResolver(sources);
    expect(resolve({ vendor: "不存在厂商", providerKey: "nope" })).toBeUndefined();
  });
});
