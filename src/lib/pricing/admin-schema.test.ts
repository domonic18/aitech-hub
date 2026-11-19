/**
 * 牌价策展契约单测(M55 批A):Zod 契约(dataAsOf 北京日折算 / modelKey 形态 /
 * sourceUrl http 前缀)、更新契约不得泄漏 create 默认值、人工定稿闸 isPinned。
 *
 * 纯契约、无库依赖——CRUD 在 admin-model.test.ts / admin-plan.test.ts,
 * 按源下架在 offline-source.test.ts。
 */
import { describe, expect, it } from "vitest";

import {
  codingPlanCreateSchema,
  codingPlanUpdateSchema,
  modelPricingCreateSchema,
  modelPricingTiersUpdateSchema,
  modelPricingUpdateSchema,
} from "./admin-schema";

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

describe("档位订正契约", () => {
  it("档位名必填、单价非负、单位枚举", () => {
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
