/**
 * 牌价策展单测(M55 批A,prisma mock 无真库):Zod 契约(dataAsOf 北京日折算/
 * modelKey 形态/sourceUrl http 前缀)/ 反常态守卫(INVERTED_PRICING 与
 * confirmInverted 旁路)/ 状态过滤与排序传参 / Decimal→number 序列化。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const modelFindMany = vi.fn();
const modelCreate = vi.fn();
const planFindMany = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    modelPricing: {
      findMany: (...a: unknown[]) => modelFindMany(...a),
      create: (...a: unknown[]) => modelCreate(...a),
    },
    codingPlan: { findMany: (...a: unknown[]) => planFindMany(...a) },
  },
}));

import {
  codingPlanCreateSchema,
  createModelPricing,
  isInvertedPricing,
  listCodingPlans,
  listModelPricing,
  modelPricingCreateSchema,
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
    });
    await listModelPricing({});
    expect(modelFindMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
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
