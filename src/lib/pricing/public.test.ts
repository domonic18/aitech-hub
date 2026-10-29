/**
 * /pricing/ 公开读侧单测(M55 批D,prisma mock 无真库):仅 enabled 行可见
 * (停用/待审不可见)/ 45 天过期判定(空表不出提醒,边界刚好 45 天不出)/
 * 价格格(USD 原币直出,null=未公布)/ JSON-LD 清单构造(双价+截稿溯源)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyModels = vi.fn();
const findManyPlans = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    modelPricing: { findMany: (...a: unknown[]) => findManyModels(...a) },
    codingPlan: { findMany: (...a: unknown[]) => findManyPlans(...a) },
  },
}));

import {
  buildPricingJsonLd,
  formatPrice,
  isPricingStale,
  listPublicPricing,
  PRICING_STALE_DAYS,
} from "./public";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isPricingStale", () => {
  const now = new Date("2026-10-28T00:00:00Z");
  it("超 45 天=过期;刚好 45 天不出;空表不出", () => {
    expect(
      isPricingStale(new Date(now.getTime() - (PRICING_STALE_DAYS + 1) * 86_400_000), now),
    ).toBe(true);
    expect(isPricingStale(new Date(now.getTime() - PRICING_STALE_DAYS * 86_400_000), now)).toBe(
      false,
    );
    expect(isPricingStale(null, now)).toBe(false);
  });
});

describe("formatPrice", () => {
  it("USD 原币直出不折算(D4),币符空格分隔(P1 版式);null=未公布", () => {
    expect(formatPrice(2, "CNY")).toBe("¥ 2");
    expect(formatPrice(0.25, "USD")).toBe("$ 0.25");
    expect(formatPrice(null, "CNY")).toBe("未公布");
  });
});

describe("listPublicPricing", () => {
  it("仅 enabled 行;Decimal/BigInt 展平;整表 max(dataAsOf)", async () => {
    findManyModels.mockResolvedValue([
      {
        vendor: "DeepSeek 深度求索",
        modelKey: "deepseek-flash",
        currency: "CNY",
        inputPrice: { toString: () => "2" },
        outputPrice: { toString: () => "8" },
        freeTier: null,
        contextWindow: "1M",
        note: "[官方页爬虫 2026-10-28] 矩阵",
        dataAsOf: new Date("2026-10-28T00:00:00+08:00"),
        sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
        region: "cn",
      },
      {
        vendor: "OpenAI",
        modelKey: "gpt-5",
        currency: "USD",
        inputPrice: null,
        outputPrice: { toString: () => "10" },
        freeTier: null,
        contextWindow: null,
        note: null,
        dataAsOf: new Date("2026-10-20T00:00:00+08:00"),
        sourceUrl: "https://openrouter.ai/openai/gpt-5",
        region: "intl",
      },
    ]);
    findManyPlans.mockResolvedValue([]);

    const data = await listPublicPricing();
    // where 只查 enabled(停用/待审不可见——验收锚)
    const where = findManyModels.mock.calls[0]![0] as { where: { status: string } };
    expect(where.where.status).toBe("enabled");
    expect(data.models).toHaveLength(2);
    expect(data.models[0]).toMatchObject({ inputPrice: 2, outputPrice: 8, dataAsOf: "2026-10-28" });
    expect(data.models[1]).toMatchObject({ inputPrice: null, region: "intl" });
    expect(data.modelsAsOf).toBe("2026-10-28"); // max 而非首行
    expect(data.plans).toHaveLength(0);
    expect(data.plansAsOf).toBeNull();
  });
});

describe("buildPricingJsonLd", () => {
  it("ItemList+Product 携双价与截稿溯源;空表 numberOfItems=0", () => {
    const ld = buildPricingJsonLd(
      {
        models: [
          {
            vendor: "DeepSeek 深度求索",
            modelKey: "deepseek-flash",
            currency: "CNY",
            inputPrice: 2,
            outputPrice: 8,
            freeTier: null,
            contextWindow: "1M",
            note: null,
            dataAsOf: "2026-10-28",
            sourceUrl: "https://x",
            region: "cn",
          },
        ],
        plans: [],
        modelsAsOf: "2026-10-28",
        plansAsOf: null,
      },
      "https://17aitech.com/pricing/",
    );
    expect(ld).toMatchObject({ "@type": "ItemList", numberOfItems: 1 });
    const item = (ld.itemListElement as Array<{ item: Record<string, string> }>)[0]!.item;
    expect(item.name).toBe("DeepSeek 深度求索 deepseek-flash");
    expect(item.description).toContain("输入 ¥ 2 / 输出 ¥ 8");
    expect(item.description).toContain("数据截至 2026-10-28");
    expect(
      buildPricingJsonLd({ models: [], plans: [], modelsAsOf: null, plansAsOf: null }, "u"),
    ).toMatchObject({ numberOfItems: 0, itemListElement: [] });
  });
});
