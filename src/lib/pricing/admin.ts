/**
 * 模型牌价策展读侧(M55 批A):model_pricing / coding_plan 双表的 Zod 契约
 * 与 CRUD 单源。爬虫/手工数据均落 pending,
 * enabled=终审可见(disabled=停用下架);价格统一「货币 / 百万 tokens」。
 * 反常态守卫:输入价 > 输出价需 confirmInverted 显式确认(防小数点错位静默发布)。
 * 鉴权在路由层(仅会话,PAT 拒绝,同 taxonomy 口径);唯一冲突上抛由路由映射 409。
 */
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";

import { TIER_UNITS } from "./constants";
import { replaceTiers } from "./tiers";

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

/** 行出参(Decimal→number,BigInt→string;admin 台账与公开页共用形状基座) */
function serializeModelRow(row: {
  id: bigint;
  vendor: string;
  modelKey: string;
  currency: string;
  inputPrice: Prisma.Decimal | null;
  outputPrice: Prisma.Decimal | null;
  freeTier: string | null;
  contextWindow: string | null;
  note: string | null;
  dataAsOf: Date;
  sourceUrl: string;
  region: string;
  status: string;
  isPinned: boolean;
  isFree: boolean;
  priceUnit: string;
  sortOrder: number;
  provider?: { name: string } | null;
  model?: { modality: string } | null;
  tiers?: Array<{
    tierLabel: string;
    inputPrice: Prisma.Decimal | null;
    outputPrice: Prisma.Decimal | null;
    cachePrice: Prisma.Decimal | null;
    minTokens: number | null;
    maxTokens: number | null;
    unit: string;
    currency: string;
    dataAsOf: Date;
    sourceUrl: string;
    note: string | null;
  }>;
}) {
  return {
    id: row.id.toString(),
    vendor: row.vendor,
    providerName: row.provider?.name ?? null,
    modelKey: row.modelKey,
    currency: row.currency,
    inputPrice: row.inputPrice === null ? null : Number(row.inputPrice),
    outputPrice: row.outputPrice === null ? null : Number(row.outputPrice),
    freeTier: row.freeTier,
    contextWindow: row.contextWindow,
    note: row.note,
    dataAsOf: row.dataAsOf.toISOString().slice(0, 10),
    sourceUrl: row.sourceUrl,
    region: row.region,
    status: row.status,
    isPinned: row.isPinned,
    isFree: row.isFree,
    priceUnit: row.priceUnit,
    modality: row.model?.modality ?? null,
    sortOrder: row.sortOrder,
    tiers: (row.tiers ?? []).map((t) => ({
      tierLabel: t.tierLabel,
      inputPrice: t.inputPrice === null ? null : Number(t.inputPrice),
      outputPrice: t.outputPrice === null ? null : Number(t.outputPrice),
      cachePrice: t.cachePrice === null ? null : Number(t.cachePrice),
      minTokens: t.minTokens,
      maxTokens: t.maxTokens,
      unit: t.unit,
      currency: t.currency,
      dataAsOf: t.dataAsOf,
      sourceUrl: t.sourceUrl,
      note: t.note,
    })),
  };
}

function serializePlanRow(row: {
  id: bigint;
  vendor: string;
  planName: string;
  currency: string;
  monthlyFee: Prisma.Decimal | null;
  quarterlyFee: Prisma.Decimal | null;
  yearlyFee: Prisma.Decimal | null;
  billingNote: string | null;
  benefits: Prisma.JsonValue | null;
  quotaDesc: string;
  peakRate: string | null;
  offPeakRate: string | null;
  bestFor: string | null;
  note: string | null;
  dataAsOf: Date;
  sourceUrl: string;
  status: string;
  isPinned: boolean;
  sortOrder: number;
}) {
  return {
    id: row.id.toString(),
    vendor: row.vendor,
    planName: row.planName,
    currency: row.currency,
    monthlyFee: row.monthlyFee === null ? null : Number(row.monthlyFee),
    quarterlyFee: row.quarterlyFee === null ? null : Number(row.quarterlyFee),
    yearlyFee: row.yearlyFee === null ? null : Number(row.yearlyFee),
    billingNote: row.billingNote,
    benefits: Array.isArray(row.benefits) ? (row.benefits as string[]) : null,
    quotaDesc: row.quotaDesc,
    peakRate: row.peakRate,
    offPeakRate: row.offPeakRate,
    bestFor: row.bestFor,
    note: row.note,
    dataAsOf: row.dataAsOf.toISOString().slice(0, 10),
    sourceUrl: row.sourceUrl,
    status: row.status,
    isPinned: row.isPinned,
    sortOrder: row.sortOrder,
  };
}

export type ModelPricingRow = ReturnType<typeof serializeModelRow>;
export type CodingPlanRow = ReturnType<typeof serializePlanRow>;

/** 反常态判定(纯函数,单测锚):两价齐备且输入 > 输出 = 需人工确认 */
export function isInvertedPricing(inputPrice: number | null, outputPrice: number | null): boolean {
  return inputPrice !== null && outputPrice !== null && inputPrice > outputPrice;
}

function assertNotInverted(
  input: number | null | undefined,
  output: number | null | undefined,
  confirm: boolean | undefined,
): void {
  if (!confirm && isInvertedPricing(input ?? null, output ?? null)) {
    throw new Error("INVERTED_PRICING");
  }
}

export async function listModelPricing(
  opts: {
    status?: PricingStatus;
    region?: string;
  } = {},
): Promise<ModelPricingRow[]> {
  const rows = await prisma.modelPricing.findMany({
    where: {
      ...(opts.status === undefined ? {} : { status: opts.status }),
      ...(opts.region === undefined ? {} : { region: opts.region }),
    },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    include: {
      provider: { select: { name: true } },
      model: { select: { modality: true } },
      tiers: { orderBy: { tierLabel: "asc" } },
    },
  });
  return rows.map(serializeModelRow);
}

/** 公开页即时再验证(M56 验收反馈一:终审后 /pricing/ 被 ISR 600s 挡住,
 * 空态误导「未上架」;管理侧任何行变更统一刷公开页。爬虫只产 pending
 * 不影响公开面,不需触发)。 */
function revalidatePublicPricing(): void {
  revalidatePath("/pricing/");
}

export async function createModelPricing(input: ModelPricingCreateInput): Promise<ModelPricingRow> {
  assertNotInverted(input.inputPrice, input.outputPrice, input.confirmInverted);
  const { confirmInverted: _confirm, ...data } = input;
  const row = await prisma.modelPricing.create({ data });
  revalidatePublicPricing();
  return serializeModelRow(row);
}

export async function updateModelPricing(
  id: bigint,
  input: ModelPricingUpdateInput,
): Promise<ModelPricingRow | null> {
  const existing = await prisma.modelPricing.findUnique({ where: { id } });
  if (!existing) return null;
  assertNotInverted(
    input.inputPrice ?? (existing.inputPrice === null ? null : Number(existing.inputPrice)),
    input.outputPrice ?? (existing.outputPrice === null ? null : Number(existing.outputPrice)),
    input.confirmInverted,
  );
  const { confirmInverted: _confirm, ...data } = input;
  const row = await prisma.modelPricing.update({ where: { id }, data });
  revalidatePublicPricing();
  return serializeModelRow(row);
}

/**
 * 批量终审(M74 批C):采集落 pending,批量「通过」才能上架——否则爬虫产出的行
 * 永远停在待审,前台一条都看不到。返回实际改动行数。
 */
export async function bulkReviewModelPricing(
  ids: string[],
  status: PricingStatus,
): Promise<number> {
  const parsed = ids.map((id) => {
    try {
      return BigInt(id);
    } catch {
      return null;
    }
  });
  const valid = parsed.filter((v): v is bigint => v !== null);
  if (valid.length === 0) return 0;
  const result = await prisma.modelPricing.updateMany({
    where: { id: { in: valid } },
    data: { status },
  });
  revalidatePublicPricing();
  return result.count;
}

/**
 * 档位订正(M74 批C2):阶梯/缓存/峰谷价的人工订正入口。
 * 整行档位替换(与采集侧 replaceTiers 同口径:档位集按源整批刷新,不增量合并)。
 */
export async function updateModelPricingTiers(
  id: bigint,
  tiers: ModelPricingTierInput[],
): Promise<number | null> {
  const row = await prisma.modelPricing.findUnique({
    where: { id },
    select: { id: true, currency: true, sourceUrl: true },
  });
  if (row === null) return null;
  const labels = new Set<string>();
  for (const t of tiers) {
    if (labels.has(t.tierLabel)) {
      throw new Error(`档位名重复:${t.tierLabel}`);
    }
    labels.add(t.tierLabel);
  }
  await replaceTiers(
    id,
    tiers.map((t) => ({
      tierLabel: t.tierLabel,
      inputPrice: t.inputPrice ?? null,
      outputPrice: t.outputPrice ?? null,
      cachePrice: t.cachePrice ?? null,
      minTokens: t.minTokens ?? null,
      maxTokens: t.maxTokens ?? null,
      unit: t.unit,
      currency: row.currency,
      dataAsOf: new Date(),
      sourceUrl: row.sourceUrl,
    })),
  );
  revalidatePublicPricing();
  return tiers.length;
}

export async function deleteModelPricing(id: bigint): Promise<void> {
  await prisma.modelPricing.delete({ where: { id } });
  revalidatePublicPricing();
}

export async function listCodingPlans(
  opts: {
    status?: PricingStatus;
  } = {},
): Promise<CodingPlanRow[]> {
  const rows = await prisma.codingPlan.findMany({
    where: opts.status === undefined ? {} : { status: opts.status },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map(serializePlanRow);
}

/** benefits null → Prisma.DbNull(Json 列空值入参需显式哨兵,直传 null 类型不通) */
function benefitsInput(
  v: CodingPlanCreateInput["benefits"],
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : v;
}

export async function createCodingPlan(input: CodingPlanCreateInput): Promise<CodingPlanRow> {
  const { confirmInverted: _confirm, benefits, ...data } = input;
  const row = await prisma.codingPlan.create({
    data: { ...data, benefits: benefitsInput(benefits) },
  });
  revalidatePublicPricing();
  return serializePlanRow(row);
}

export async function updateCodingPlan(
  id: bigint,
  input: CodingPlanUpdateInput,
): Promise<CodingPlanRow | null> {
  const existing = await prisma.codingPlan.findUnique({ where: { id } });
  if (!existing) return null;
  const { confirmInverted: _confirm, benefits, ...data } = input;
  const row = await prisma.codingPlan.update({
    where: { id },
    data: {
      ...data,
      ...(benefits === undefined ? {} : { benefits: benefitsInput(benefits) }),
    },
  });
  revalidatePublicPricing();
  return serializePlanRow(row);
}

export async function deleteCodingPlan(id: bigint): Promise<void> {
  await prisma.codingPlan.delete({ where: { id } });
  revalidatePublicPricing();
}
