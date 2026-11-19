/**
 * 模型牌价策展契约(M55 批A):model_pricing / coding_plan 双表的 Zod 契约与类型。
 *
 * 爬虫/手工数据均落 pending,enabled=终审可见(disabled=停用下架);价格统一
 * 「货币 / 百万 tokens」。反常态守卫:输入价 > 输出价需 confirmInverted 显式确认
 * (防小数点错位静默发布)。鉴权在路由层(仅会话,PAT 拒绝,同 taxonomy 口径);
 * 唯一冲突上抛由路由映射 409。
 *
 * 纯契约、无库依赖——CRUD 在 admin-model.ts / admin-plan.ts,按源下架在
 * offline-source.ts。
 */
import { z } from "zod";

import { TIER_UNITS } from "./constants";

export const PRICING_STATUSES = ["pending", "enabled", "disabled"] as const;
export type PricingStatus = (typeof PRICING_STATUSES)[number];

export const CURRENCIES = ["CNY", "USD"] as const;

const money = z.number().min(0).max(9999).nullable();

const asOf = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dataAsOf 须为 YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00+08:00`));

const source = z.string().trim().min(1).max(300).startsWith("http");

/**
 * ⚠️ create 与 update **必须各写一份**(不能 update = create.partial()):
 * zod v4 的 `.partial()` 挡不住 `.default()`——缺省的键仍会拿到默认值,
 * 于是「只改价格」的 PUT 会把 status 打回 pending(已上架的行从前台消失)、
 * currency 重置 CNY、isPinned 定稿闸被清掉(采集随即覆盖该行)。
 * 更新语义是「只写传入的字段」,故 update 全部 optional 且**无 default**。
 */
export const modelPricingCreateSchema = z.object({
  vendor: z.string().trim().min(1).max(40),
  modelKey: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "modelKey 仅限字母/数字/点/连字符/下划线"),
  currency: z.enum(CURRENCIES).default("CNY"),
  inputPrice: money,
  outputPrice: money,
  freeTier: z.string().trim().max(60).nullable(),
  contextWindow: z.string().trim().max(20).nullable(),
  note: z.string().trim().max(200).nullish(),
  dataAsOf: asOf,
  sourceUrl: source,
  region: z.enum(["cn", "intl"]).default("cn"),
  status: z.enum(PRICING_STATUSES).default("pending"),
  // 人工定稿:采集不覆盖本行(M73;展示态与能否刷新解耦)
  isPinned: z.boolean().default(false),
  // 完全免费标记(M74 批C):采集侧按档位全零判定,人工可覆写
  // (与 freeTier「有免费额度」是两种语义)
  isFree: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  confirmInverted: z.boolean().default(false),
});

export const modelPricingUpdateSchema = z.object({
  vendor: z.string().trim().min(1).max(40).optional(),
  modelKey: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "modelKey 仅限字母/数字/点/连字符/下划线")
    .optional(),
  currency: z.enum(CURRENCIES).optional(),
  inputPrice: money.optional(),
  outputPrice: money.optional(),
  freeTier: z.string().trim().max(60).nullable().optional(),
  contextWindow: z.string().trim().max(20).nullable().optional(),
  note: z.string().trim().max(200).nullish().optional(),
  dataAsOf: asOf.optional(),
  sourceUrl: source.optional(),
  region: z.enum(["cn", "intl"]).optional(),
  status: z.enum(PRICING_STATUSES).optional(),
  isPinned: z.boolean().optional(),
  isFree: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  confirmInverted: z.boolean().optional(),
});

export const codingPlanCreateSchema = z.object({
  vendor: z.string().trim().min(1).max(40),
  planName: z.string().trim().min(1).max(60),
  currency: z.enum(CURRENCIES).default("CNY"),
  monthlyFee: money,
  quarterlyFee: money.nullish(),
  yearlyFee: money.nullish(),
  billingNote: z.string().trim().max(120).nullish(),
  benefits: z.array(z.string().trim().min(1).max(200)).max(20).nullish(),
  quotaDesc: z.string().trim().min(1).max(200),
  peakRate: z.string().trim().max(60).nullable(),
  offPeakRate: z.string().trim().max(60).nullable(),
  bestFor: z.string().trim().max(80).nullable(),
  note: z.string().trim().max(200).nullish(),
  dataAsOf: asOf,
  sourceUrl: source,
  status: z.enum(PRICING_STATUSES).default("pending"),
  // 人工定稿:采集不覆盖本行(M73;展示态与能否刷新解耦)
  isPinned: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  confirmInverted: z.boolean().default(false),
});

/** 同 modelPricingUpdateSchema:更新只写传入的字段,不带 default */
export const codingPlanUpdateSchema = z.object({
  vendor: z.string().trim().min(1).max(40).optional(),
  planName: z.string().trim().min(1).max(60).optional(),
  currency: z.enum(CURRENCIES).optional(),
  monthlyFee: money.optional(),
  quarterlyFee: money.nullish().optional(),
  yearlyFee: money.nullish().optional(),
  billingNote: z.string().trim().max(120).nullish().optional(),
  benefits: z.array(z.string().trim().min(1).max(200)).max(20).nullish().optional(),
  quotaDesc: z.string().trim().min(1).max(200).optional(),
  peakRate: z.string().trim().max(60).nullable().optional(),
  offPeakRate: z.string().trim().max(60).nullable().optional(),
  bestFor: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(200).nullish().optional(),
  dataAsOf: asOf.optional(),
  sourceUrl: source.optional(),
  status: z.enum(PRICING_STATUSES).optional(),
  isPinned: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  confirmInverted: z.boolean().optional(),
});

/** 档位计价单位(纯常量模块;客户端组件也从那里引,避免把 prisma 打进 bundle) */
export { TIER_UNITS, TIER_UNIT_LABELS, type TierUnit } from "./constants";

/** 单档位契约(人工订正阶梯/缓存/峰谷价) */
export const modelPricingTierSchema = z.object({
  tierLabel: z.string().trim().min(1).max(60),
  inputPrice: money.nullish(),
  outputPrice: money.nullish(),
  cachePrice: money.nullish(),
  minTokens: z.number().int().nonnegative().nullish(),
  maxTokens: z.number().int().nonnegative().nullish(),
  unit: z.enum(TIER_UNITS).default("per_1m_tokens"),
});

export const modelPricingTiersUpdateSchema = z.object({
  tiers: z.array(modelPricingTierSchema).max(50),
});

export type ModelPricingTierInput = z.infer<typeof modelPricingTierSchema>;

export type ModelPricingCreateInput = z.infer<typeof modelPricingCreateSchema>;
export type ModelPricingUpdateInput = z.infer<typeof modelPricingUpdateSchema>;
export type CodingPlanCreateInput = z.infer<typeof codingPlanCreateSchema>;
export type CodingPlanUpdateInput = z.infer<typeof codingPlanUpdateSchema>;

/** 校验错误人话化:带字段路径(此前裸 message 聚合丢路径,表单排错靠猜) */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

export interface PricingRowShape {
  id: string;
  vendor: string;
  status: string;
  currency: string;
  dataAsOf: string;
  sourceUrl: string;
  sortOrder: number;
}
