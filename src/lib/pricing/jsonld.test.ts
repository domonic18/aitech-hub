/**
 * /pricing/ JSON-LD 单测(M74 批D7):结构化字段补齐(brand/identifier/category/
 * additionalProperty)+ 红线断言(不用 Offer)+ 锚点一致性 + 比价摘要并入。
 * 构造器自 public.ts 迁来(批D7),原 public.test 里的用例随迁。
 */
import { describe, expect, it } from "vitest";

import { buildPricingJsonLd, modelAnchorId, type PricingCompareEntry } from "./jsonld";
import type { PublicModelRow } from "./public";

function model(over: Partial<PublicModelRow>): PublicModelRow {
  return {
    vendor: "DeepSeek 深度求索",
    modelKey: "deepseek-flash",
    currency: "CNY",
    inputPrice: 2,
    outputPrice: 8,
    freeTier: null,
    isFree: false,
    contextWindow: "1M",
    note: null,
    dataAsOf: "2026-10-28",
    sourceUrl: "https://x",
    region: "cn",
    providerKey: "deepseek",
    providerName: "DeepSeek 深度求索",
    providerKind: "official",
    modelDictKey: "deepseek-flash",
    modality: "text",
    priceUnit: "per_1m_tokens",
    protocols: [],
    tiers: [],
    ...over,
  };
}

const compareEntries: PricingCompareEntry[] = [
  {
    key: "deepseek-flash",
    displayName: "deepseek-flash",
    providerCount: 3,
    cheapestProvider: "硅基流动",
    cheapestPrice: 1.5,
    currency: "CNY",
  },
];

describe("buildPricingJsonLd(批D7 扩充)", () => {
  const ld = buildPricingJsonLd(
    {
      models: [model({})],
      plans: [],
      modelsAsOf: "2026-10-28",
      plansAsOf: null,
    },
    "https://17aitech.com/pricing/",
    { compare: compareEntries },
  );
  const item = (ld.itemListElement as Array<{ item: Record<string, unknown> }>)[0]!.item;

  it("ItemList + Product 基础面不变:名称/双价描述/截稿溯源", () => {
    expect(ld).toMatchObject({ "@type": "ItemList", numberOfItems: 1 });
    expect(item.name).toBe("DeepSeek 深度求索 deepseek-flash");
    expect(item.description).toContain("输入 ¥ 2 / 输出 ¥ 8");
    expect(item.description).toContain("数据截至 2026-10-28");
  });

  it("补结构化字段:brand / identifier / sku / category", () => {
    expect(item.brand).toMatchObject({ "@type": "Brand", name: "DeepSeek 深度求索" });
    expect(item.identifier).toBe("pricing:DeepSeek 深度求索|deepseek-flash");
    expect(item.sku).toBe(item.identifier);
    expect(item.category).toContain("文本模型");
  });

  it("additionalProperty 携价格与比价摘要(机器可读,不冒充卖方)", () => {
    const props = item.additionalProperty as Array<Record<string, unknown>>;
    const names = props.map((p) => p.name);
    expect(names).toContain("输入价");
    expect(names).toContain("输出价");
    expect(names).toContain("计价单位");
    expect(names).toContain("同模型报价家数");
    expect(names).toContain("最低价提供商");
  });

  it("红线:不得出现 Offer(本站不卖 API,冒充卖方有作弊信号)", () => {
    expect(JSON.stringify(ld)).not.toContain('"@type":"Offer"');
    expect(JSON.stringify(ld)).not.toContain('"offers"');
  });

  it("url 指向真锚点:与前台行 id 同源(modelAnchorId)", () => {
    expect(item.url).toBe(
      `https://17aitech.com/pricing/#${modelAnchorId("DeepSeek 深度求索", "deepseek-flash")}`,
    );
  });

  it("空表退化为空清单(页骨架仍 SSR,SEO 面不空)", () => {
    const empty = buildPricingJsonLd(
      { models: [], plans: [], modelsAsOf: null, plansAsOf: null },
      "u",
    );
    expect(empty).toMatchObject({ numberOfItems: 0, itemListElement: [] });
  });

  it("锚点 id:中文厂商与斜杠模型键都编码为 URL 安全且可逆唯一", () => {
    const a = modelAnchorId("词元所·博川科技", "Kwai-Kolors/Kolors");
    const b = modelAnchorId("词元所·爱诗科技", "Kwai-Kolors/Kolors");
    expect(a).not.toBe(b); // 厂商不同 → 锚点不同
    expect(a).toMatch(/^p-[\w~.-]+$/); // 只含 URL 安全字符
  });
});
