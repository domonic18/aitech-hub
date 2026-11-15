/**
 * 牌价策展单测(M55 批A,prisma mock 无真库):Zod 契约(dataAsOf 北京日折算/
 * modelKey 形态/sourceUrl http 前缀)/ 反常态守卫(INVERTED_PRICING 与
 * confirmInverted 旁路)/ 状态过滤与排序传参 / Decimal→number 序列化。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const modelFindMany = vi.fn();
const modelCreate = vi.fn();
const modelFindUnique = vi.fn();
const planFindMany = vi.fn();
const replaceTiers = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("./tiers", () => ({
  replaceTiers: (...a: unknown[]) => replaceTiers(...a),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    modelPricing: {
      findMany: (...a: unknown[]) => modelFindMany(...a),
      create: (...a: unknown[]) => modelCreate(...a),
      findUnique: (...a: unknown[]) => modelFindUnique(...a),
    },
    codingPlan: { findMany: (...a: unknown[]) => planFindMany(...a) },
  },
}));

import {
  codingPlanCreateSchema,
  codingPlanUpdateSchema,
  createModelPricing,
  isInvertedPricing,
  listCodingPlans,
  listModelPricing,
  modelPricingCreateSchema,
  modelPricingTiersUpdateSchema,
  modelPricingUpdateSchema,
  updateModelPricingTiers,
} from "./admin";

const VALID_MODEL = {
  vendor: "DeepSeek",
  modelKey: "deepseek-v3.2",
  currency: "CNY" as const,
  inputPrice: 2,
  outputPrice: 8,
  freeTier: null,
  contextWindow: "128K",
  note: null,
  dataAsOf: "2026-10-28",
  sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
  region: "cn" as const,
  status: "pending" as const,
  sortOrder: 0,
  confirmInverted: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("modelPricingCreateSchema", () => {
  it("合法体通过,dataAsOf 折算北京当日零点", () => {
    const parsed = modelPricingCreateSchema.parse(VALID_MODEL);
    expect(parsed.dataAsOf.toISOString()).toBe("2026-10-27T16:00:00.000Z");
    expect(parsed.status).toBe("pending");
  });

  it("modelKey 形态守卫:非法字符拒", () => {
    expect(
      modelPricingCreateSchema.safeParse({ ...VALID_MODEL, modelKey: "bad key!" }).success,
    ).toBe(false);
  });

  it("sourceUrl 非 http 前缀拒", () => {
    expect(
      modelPricingCreateSchema.safeParse({ ...VALID_MODEL, sourceUrl: "javascript:alert(1)" })
        .success,
    ).toBe(false);
  });

  it("负价格拒;缺省 status=pending", () => {
    expect(modelPricingCreateSchema.safeParse({ ...VALID_MODEL, inputPrice: -1 }).success).toBe(
      false,
    );
    const minimal = modelPricingCreateSchema.parse({
      ...VALID_MODEL,
      currency: undefined,
      region: undefined,
      status: undefined,
      sortOrder: undefined,
    });
    expect(minimal.currency).toBe("CNY");
    expect(minimal.region).toBe("cn");
  });
});

describe("isInvertedPricing 反常态", () => {
  it("两价齐备且输入>输出为真;缺一或正常序为假", () => {
    expect(isInvertedPricing(8, 2)).toBe(true);
    expect(isInvertedPricing(2, 8)).toBe(false);
    expect(isInvertedPricing(null, 8)).toBe(false);
    expect(isInvertedPricing(2, null)).toBe(false);
  });
});

describe("createModelPricing", () => {
  it("反常态未确认抛 INVERTED_PRICING", async () => {
    await expect(
      createModelPricing(
        modelPricingCreateSchema.parse({ ...VALID_MODEL, inputPrice: 8, outputPrice: 2 }),
      ),
    ).rejects.toThrow("INVERTED_PRICING");
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it("反常态 confirmInverted 旁路可建;confirmInverted 不落库", async () => {
    modelCreate.mockResolvedValue({
      id: BigInt(1),
      vendor: "DeepSeek",
      modelKey: "deepseek-v3.2",
      currency: "CNY",
      inputPrice: { toString: () => "8" },
      outputPrice: { toString: () => "2" },
      freeTier: null,
      contextWindow: "128K",
      note: null,
      dataAsOf: new Date("2026-10-28T00:00:00+08:00"),
      sourceUrl: VALID_MODEL.sourceUrl,
      region: "cn",
      status: "pending",
      sortOrder: 0,
    });
    const row = await createModelPricing(
      modelPricingCreateSchema.parse({
        ...VALID_MODEL,
        inputPrice: 8,
        outputPrice: 2,
        confirmInverted: true,
      }),
    );
    expect(row.inputPrice).toBe(8);
    expect(row.id).toBe("1");
    const arg = modelCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.confirmInverted).toBeUndefined();
  });
});

describe("list 过滤", () => {
  it("status/region 下推 where,排序 sortOrder→updatedAt", async () => {
    modelFindMany.mockResolvedValue([]);
    await listModelPricing({ status: "enabled", region: "cn" });
    expect(modelFindMany).toHaveBeenCalledWith({
      where: { status: "enabled", region: "cn" },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      // M74 批C:带厂商字典关联(后台展示归一后的厂商名);批C2:带档位(人工订正入口)
      include: {
        provider: { select: { name: true } },
        tiers: { orderBy: { tierLabel: "asc" } },
      },
    });
    await listModelPricing({});
    expect(modelFindMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      include: {
        provider: { select: { name: true } },
        tiers: { orderBy: { tierLabel: "asc" } },
      },
    });
  });

  it("套餐列表 status 过滤同构", async () => {
    planFindMany.mockResolvedValue([]);
    await listCodingPlans({ status: "pending" });
    expect(planFindMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    });
  });
});

describe("codingPlanCreateSchema", () => {
  it("quotaDesc 必填(口径原文不归一);月费可空", () => {
    const base = {
      vendor: "智谱 AI",
      planName: "GLM Coding Plan · Lite",
      monthlyFee: 29,
      quotaDesc: "GLM-4.6:120 prompts / 5h",
      peakRate: "峰 1×",
      offPeakRate: "谷 0.5×",
      bestFor: "个人日常",
      dataAsOf: "2026-10-28",
      sourceUrl: "https://open.bigmodel.cn/pricing",
    };
    expect(codingPlanCreateSchema.parse(base).monthlyFee).toBe(29);
    expect(codingPlanCreateSchema.safeParse({ ...base, quotaDesc: "" }).success).toBe(false);
    expect(codingPlanCreateSchema.parse({ ...base, monthlyFee: null }).monthlyFee).toBeNull();
  });
});

describe("人工定稿闸 isPinned(M73)", () => {
  it("新建缺省未定稿(可被采集刷新);更新体可显式置位/清位", () => {
    const base = {
      vendor: "阿里云百炼",
      planName: "百炼 Token Plan · Lite",
      monthlyFee: 39,
      quotaDesc: "20,000 Credits/月",
      peakRate: null,
      offPeakRate: null,
      bestFor: null,
      note: null,
      dataAsOf: "2026-11-14",
      sourceUrl: "https://help.aliyun.com/zh/model-studio/token-plan-personal-overview",
    };
    expect(codingPlanCreateSchema.parse(base).isPinned).toBe(false);
    // 更新体只带 isPinned 也合法(行操作区只发这一个字段)
    expect(codingPlanUpdateSchema.safeParse({ isPinned: true }).success).toBe(true);
    expect(codingPlanUpdateSchema.parse({ isPinned: true }).isPinned).toBe(true);
    expect(codingPlanUpdateSchema.parse({ isPinned: false }).isPinned).toBe(false);
  });
});

describe("M74 批C:更新契约不得泄漏 create 默认值", () => {
  it("只传价格 → 不带 status/currency/region/isPinned(行内改价不得把已上架行打回 pending)", () => {
    const parsed = modelPricingUpdateSchema.parse({ inputPrice: 1, outputPrice: 2 });
    expect(parsed).toEqual({ inputPrice: 1, outputPrice: 2 });
    expect("status" in parsed).toBe(false);
    expect("currency" in parsed).toBe(false);
    expect("isPinned" in parsed).toBe(false);
  });

  it("显式传的字段照旧生效", () => {
    expect(modelPricingUpdateSchema.parse({ status: "enabled" })).toEqual({ status: "enabled" });
    expect(modelPricingUpdateSchema.parse({ isFree: true })).toEqual({ isFree: true });
  });

  it("create 契约的默认值不受影响", () => {
    const parsed = modelPricingCreateSchema.parse({
      vendor: "v",
      modelKey: "model-x",
      inputPrice: null,
      outputPrice: null,
      freeTier: null,
      contextWindow: null,
      dataAsOf: "2026-11-15",
      sourceUrl: "https://example.com",
    });
    expect(parsed.status).toBe("pending");
    expect(parsed.currency).toBe("CNY");
    expect(parsed.isPinned).toBe(false);
    expect(parsed.isFree).toBe(false);
  });

  it("套餐更新契约同样不带默认(status 不得被重置)", () => {
    const parsed = codingPlanUpdateSchema.parse({ monthlyFee: 5 });
    expect(parsed).toEqual({ monthlyFee: 5 });
  });
});

describe("M74 批C2:档位订正", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelFindUnique.mockResolvedValue({
      id: BigInt(7),
      currency: "CNY",
      sourceUrl: "https://example.com",
    });
    replaceTiers.mockResolvedValue(2);
  });

  it("整行档位替换:按行币种与源页落档位", async () => {
    const n = await updateModelPricingTiers(BigInt(7), [
      {
        tierLabel: "在线推理（常规）·[0, 1024]K",
        inputPrice: 0.8,
        outputPrice: 2.7,
        cachePrice: null,
        minTokens: 0,
        maxTokens: 1048576,
        unit: "per_1m_tokens",
      },
    ]);
    expect(n).toBe(1);
    expect(replaceTiers).toHaveBeenCalledTimes(1);
    const [id, tiers] = replaceTiers.mock.calls[0] as [bigint, Array<Record<string, unknown>>];
    expect(id).toBe(BigInt(7));
    expect(tiers[0]).toMatchObject({
      tierLabel: "在线推理（常规）·[0, 1024]K",
      currency: "CNY",
      sourceUrl: "https://example.com",
      minTokens: 0,
      maxTokens: 1048576,
    });
  });

  it("档位名重复 → 报错(档位唯一键是 行+名)", async () => {
    await expect(
      updateModelPricingTiers(BigInt(7), [
        {
          tierLabel: "默认",
          inputPrice: 1,
          outputPrice: 2,
          cachePrice: null,
          minTokens: null,
          maxTokens: null,
          unit: "per_1m_tokens",
        },
        {
          tierLabel: "默认",
          inputPrice: 2,
          outputPrice: 4,
          cachePrice: null,
          minTokens: null,
          maxTokens: null,
          unit: "per_1m_tokens",
        },
      ]),
    ).rejects.toThrow(/档位名重复/);
    expect(replaceTiers).not.toHaveBeenCalled();
  });

  it("行不存在 → 返回 null(路由映射 404)", async () => {
    modelFindUnique.mockResolvedValue(null);
    expect(await updateModelPricingTiers(BigInt(9), [])).toBeNull();
  });

  it("契约:档位名必填、单价非负、单位枚举", () => {
    expect(modelPricingTiersUpdateSchema.safeParse({ tiers: [{ tierLabel: "" }] }).success).toBe(
      false,
    );
    expect(
      modelPricingTiersUpdateSchema.safeParse({
        tiers: [{ tierLabel: "t", inputPrice: -1 }],
      }).success,
    ).toBe(false);
    expect(
      modelPricingTiersUpdateSchema.safeParse({
        tiers: [{ tierLabel: "t", unit: "per_zzz" }],
      }).success,
    ).toBe(false);
    expect(modelPricingTiersUpdateSchema.safeParse({ tiers: [{ tierLabel: "t" }] }).success).toBe(
      true,
    );
  });
});
