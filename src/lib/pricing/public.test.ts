/**
 * /pricing/ 公开读侧单测(M55 批D,prisma mock 无真库):仅 enabled 行可见
 * (停用/待审不可见)/ 45 天过期判定(空表不出提醒,边界刚好 45 天不出)/
 * 价格格(USD 原币直出,null=未公布)/ JSON-LD 清单构造(双价+截稿溯源)/
 * 分组排序(P2-15:国内¥→国际$→混合组,同组内稳定)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyModels = vi.fn();
const findManyPlans = vi.fn();
const findManyTiers = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    modelPricing: { findMany: (...a: unknown[]) => findManyModels(...a) },
    codingPlan: { findMany: (...a: unknown[]) => findManyPlans(...a) },
    modelPricingTier: { findMany: (...a: unknown[]) => findManyTiers(...a) },
  },
}));

import {
  buildPricingJsonLd,
  filterModelRows,
  filterPricingRows,
  formatPrice,
  inContextBand,
  inPriceBand,
  isPricingStale,
  parseContextTokens,
  PRICE_BANDS,
  PRICING_STALE_DAYS,
  sortModelRows,
  sortPublicModels,
  vendorOptions,
  type PriceBandId,
  type PublicModelRow,
} from "./public";
import { listPublicPricing } from "./read";

beforeEach(() => {
  vi.clearAllMocks();
  findManyTiers.mockResolvedValue([]);
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

describe("sortPublicModels", () => {
  // P2-15:国内¥ → 国际$ → 混合组(组间 region|currency 字典序);稳定排序
  const row = (region: string, currency: string, modelKey: string): PublicModelRow => ({
    vendor: "V",
    modelKey,
    currency,
    inputPrice: null,
    outputPrice: null,
    freeTier: null,
    isFree: false,
    contextWindow: null,
    note: null,
    dataAsOf: "2026-10-28",
    sourceUrl: "https://x",
    region,
    providerKey: null,
    providerName: "V",
    providerKind: null,
    modelDictKey: null,
    modality: null,
    tiers: [],
  });
  it("混合组排序:国内¥→国际$→其余按键字典序;同组内保持入参原序", () => {
    const sorted = sortPublicModels([
      row("intl", "USD", "gpt-a"),
      row("cn", "USD", "cn-usd-1"),
      row("intl", "CNY", "intl-cny-1"),
      row("cn", "CNY", "deepseek-a"),
      row("cn", "CNY", "deepseek-b"),
    ]);
    expect(sorted.map((r) => r.modelKey)).toEqual([
      "deepseek-a", // cn|CNY 权重 0(组内原序:稳定排序)
      "deepseek-b",
      "gpt-a", // intl|USD 权重 1
      "cn-usd-1", // 混合组权重 2,键字典序 cn|USD < intl|CNY
      "intl-cny-1",
    ]);
  });
  it("不改动入参数组(纯函数);空表原样返回", () => {
    const input = [row("intl", "USD", "gpt-a"), row("cn", "CNY", "deepseek-a")];
    const sorted = sortPublicModels(input);
    expect(input.map((r) => r.modelKey)).toEqual(["gpt-a", "deepseek-a"]);
    expect(sorted.map((r) => r.modelKey)).toEqual(["deepseek-a", "gpt-a"]);
    expect(sortPublicModels([])).toEqual([]);
  });
});

describe("listPublicPricing", () => {
  it("仅 enabled 行;Decimal/BigInt 展平;整表 max(dataAsOf)", async () => {
    findManyModels.mockResolvedValue([
      {
        id: BigInt(1),
        vendor: "DeepSeek 深度求索",
        modelKey: "deepseek-flash",
        currency: "CNY",
        inputPrice: { toString: () => "2" },
        outputPrice: { toString: () => "8" },
        freeTier: null,
        isFree: false,
        contextWindow: "1M",
        note: "[官方页爬虫 2026-10-28] 矩阵",
        dataAsOf: new Date("2026-10-28T00:00:00+08:00"),
        sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
        region: "cn",
        provider: { key: "deepseek", name: "DeepSeek 深度求索" },
        model: { modelKey: "deepseek-flash", modality: "text" },
      },
      {
        id: BigInt(2),
        vendor: "OpenAI",
        modelKey: "gpt-5",
        currency: "USD",
        inputPrice: null,
        outputPrice: { toString: () => "10" },
        freeTier: null,
        isFree: false,
        contextWindow: null,
        note: null,
        dataAsOf: new Date("2026-10-20T00:00:00+08:00"),
        sourceUrl: "https://openrouter.ai/openai/gpt-5",
        region: "intl",
        provider: null,
        model: null,
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

describe("展示侧筛选(验收问题一)", () => {
  it("inPriceBand 左闭右开;null 只在「全部」档(false 归入具体区间=臆测)", () => {
    expect(inPriceBand(0, "lt10")).toBe(true);
    expect(inPriceBand(9.99, "lt10")).toBe(true);
    expect(inPriceBand(10, "lt10")).toBe(false); // 右开
    expect(inPriceBand(10, "10-50")).toBe(true); // 左闭
    expect(inPriceBand(50, "10-50")).toBe(false);
    expect(inPriceBand(300, "gte300")).toBe(true);
    expect(inPriceBand(299.9, "gte300")).toBe(false);
    for (const b of PRICE_BANDS) {
      expect(inPriceBand(null, b.id as PriceBandId)).toBe(b.id === "all");
    }
    // 区间无缝无叠:相邻具体档边界恰好交接(「全部」档不参与,它是全集)
    for (let i = 2; i < PRICE_BANDS.length; i += 1) {
      expect(PRICE_BANDS[i]!.min).toBe(PRICE_BANDS[i - 1]!.max);
    }
  });

  it("vendorOptions 去重 + 中英文混排字典序(不改动入参)", () => {
    const rows = [
      { vendor: "智谱 AI · BigModel" },
      { vendor: "小米 MiMo" },
      { vendor: "小米 MiMo" },
    ];
    const opts = vendorOptions(rows, (r) => r.vendor);
    expect(opts).toHaveLength(2);
    expect(new Set(opts).size).toBe(2);
    expect(rows).toHaveLength(3);
    expect(vendorOptions([], (r: { vendor: string }) => r.vendor)).toEqual([]);
  });

  it("filterPricingRows:厂商空数组=全选;厂商×区间取交集;价格 null 被具体区间排除", () => {
    const row = (vendor: string, monthlyFee: number | null) => ({ vendor, monthlyFee });
    const rows = [
      row("小米 MiMo", 39),
      row("小米 MiMo", 99),
      row("智谱 AI · BigModel", 149),
      row("阿里云百炼", null),
    ];
    const opts = (vendors: string[], band: PriceBandId) => ({
      vendors,
      band,
      vendorOf: (r: { vendor: string }) => r.vendor,
      priceOf: (r: { monthlyFee: number | null }) => r.monthlyFee,
    });

    expect(filterPricingRows(rows, opts([], "all"))).toHaveLength(4);
    expect(filterPricingRows(rows, opts(["小米 MiMo"], "all"))).toHaveLength(2);
    expect(filterPricingRows(rows, opts([], "50-100")).map((r) => r.monthlyFee)).toEqual([99]);
    expect(
      filterPricingRows(rows, opts(["小米 MiMo", "智谱 AI · BigModel"], "100-300")).map(
        (r) => r.vendor,
      ),
    ).toEqual(["智谱 AI · BigModel"]);
    // 价格未公布(null)不进具体区间档,但「全部」档照常可见(仍是有效商品)
    expect(filterPricingRows(rows, opts([], "lt10")).map((r) => r.vendor)).not.toContain(
      "阿里云百炼",
    );
    expect(filterPricingRows(rows, opts(["阿里云百炼"], "all"))).toHaveLength(1);
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
            tiers: [],
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

describe("M74 批C:上下文长度解析与分档", () => {
  it("K/M 记法 → token 数;认不出 → null", () => {
    expect(parseContextTokens("128K")).toBe(131072);
    expect(parseContextTokens("1M")).toBe(1048576);
    expect(parseContextTokens("200000")).toBe(200000);
    expect(parseContextTokens(null)).toBeNull();
    expect(parseContextTokens("—")).toBeNull();
  });

  it("分档:未知档只收未标注;下界档按 token 数", () => {
    expect(inContextBand(null, "unknown")).toBe(true);
    expect(inContextBand(131072, "unknown")).toBe(false);
    expect(inContextBand(1048576, "ge1m")).toBe(true);
    expect(inContextBand(131072, "ge1m")).toBe(false);
    expect(inContextBand(65536, "lt128k")).toBe(true);
    expect(inContextBand(null, "lt128k")).toBe(false);
    expect(inContextBand(null, "all")).toBe(true);
  });
});

describe("M74 批C:模型行筛选与排序", () => {
  const row = (over: Partial<PublicModelRow>): PublicModelRow => ({
    vendor: "V",
    modelKey: "m",
    currency: "CNY",
    inputPrice: 1,
    outputPrice: 2,
    freeTier: null,
    isFree: false,
    contextWindow: null,
    note: null,
    dataAsOf: "2026-11-15",
    sourceUrl: "https://x",
    region: "cn",
    providerKey: null,
    providerName: "V",
    providerKind: null,
    modelDictKey: null,
    modality: null,
    tiers: [],
    ...over,
  });
  const base = {
    vendors: [] as string[],
    band: "all" as PriceBandId,
    freeOnly: false,
    modality: "",
    contextBand: "all" as const,
    sourceKind: "",
  };

  it("只看免费只认完全免费标记(有免费额度不等于免费)", () => {
    const rows = [
      row({ modelKey: "free-one", isFree: true }),
      row({ modelKey: "quota", isFree: false, freeTier: "每日 200 万 tokens 免费" }),
    ];
    const out = filterModelRows(rows, { ...base, freeOnly: true });
    expect(out.map((r) => r.modelKey)).toEqual(["free-one"]);
  });

  it("模态 / 来源类型 / 上下文 三维可组合", () => {
    const rows = [
      row({ modelKey: "a", modality: "text", providerKind: "official", contextWindow: "1M" }),
      row({ modelKey: "b", modality: "image", providerKind: "aggregator", contextWindow: "32K" }),
    ];
    expect(filterModelRows(rows, { ...base, modality: "image" }).map((r) => r.modelKey)).toEqual([
      "b",
    ]);
    expect(
      filterModelRows(rows, { ...base, sourceKind: "official" }).map((r) => r.modelKey),
    ).toEqual(["a"]);
    expect(filterModelRows(rows, { ...base, contextBand: "ge1m" }).map((r) => r.modelKey)).toEqual([
      "a",
    ]);
  });

  it("排序:null 价恒排最后(未公布价不是最便宜)", () => {
    const rows = [
      row({ modelKey: "no-price", inputPrice: null }),
      row({ modelKey: "mid", inputPrice: 5 }),
      row({ modelKey: "cheap", inputPrice: 1 }),
    ];
    expect(sortModelRows(rows, "input").map((r) => r.modelKey)).toEqual([
      "cheap",
      "mid",
      "no-price",
    ]);
    // 默认即按输入价升序(这页是来找便宜的,默认按库序对用户是乱的)
    expect(sortModelRows(rows, "default").map((r) => r.modelKey)).toEqual([
      "cheap",
      "mid",
      "no-price",
    ]);
  });

  it("同价按模型名定序(结果稳定)", () => {
    const rows = [row({ modelKey: "b", inputPrice: 1 }), row({ modelKey: "a", inputPrice: 1 })];
    expect(sortModelRows(rows, "input").map((r) => r.modelKey)).toEqual(["a", "b"]);
  });
});
