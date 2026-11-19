/**
 * 牌价·模型面策展单测(M55 批A,prisma mock 无真库):反常态守卫(INVERTED_PRICING
 * 与 confirmInverted 旁路)、状态过滤与排序传参、Decimal→number 序列化、档位订正。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const modelFindMany = vi.fn();
const modelCreate = vi.fn();
const modelFindUnique = vi.fn();
const modelUpdateMany = vi.fn();
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
      updateMany: (...a: unknown[]) => modelUpdateMany(...a),
    },
  },
}));

import {
  createModelPricing,
  isInvertedPricing,
  listModelPricing,
  updateModelPricingTiers,
} from "./admin-model";
import { modelPricingCreateSchema, modelPricingTiersUpdateSchema } from "./admin-schema";

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
      // M74 批C:带厂商字典关联(后台展示归一后的厂商名);批C2:带档位(人工订正入口);
      // 批G:带模型字典模态(终审时识别文生图/视频行)
      include: {
        provider: { select: { name: true } },
        model: { select: { modality: true } },
        tiers: { orderBy: { tierLabel: "asc" } },
      },
    });
    await listModelPricing({});
    expect(modelFindMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      include: {
        provider: { select: { name: true } },
        model: { select: { modality: true } },
        tiers: { orderBy: { tierLabel: "asc" } },
      },
    });
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
