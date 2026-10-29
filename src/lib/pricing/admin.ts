/**
 * 模型牌价策展读侧(M55 批A):model_pricing / coding_plan 双表的 Zod 契约
 * 与 CRUD 单源。爬虫/手工数据均落 pending,
 * enabled=终审可见(disabled=停用下架);价格统一「货币 / 百万 tokens」。
 * 反常态守卫:输入价 > 输出价需 confirmInverted 显式确认(防小数点错位静默发布)。
 * 鉴权在路由层(仅会话,PAT 拒绝,同 taxonomy 口径);唯一冲突上抛由路由映射 409。
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";

export const PRICING_STATUSES = ["pending", "enabled", "disabled"] as const;
export type PricingStatus = (typeof PRICING_STATUSES)[number];

export const CURRENCIES = ["CNY", "USD"] as const;

const money = z.number().min(0).max(9999).nullable();

const asOf = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dataAsOf 须为 YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00+08:00`));

const source = z.string().trim().min(1).max(300).startsWith("http");

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
  sortOrder: z.number().int().default(0),
  confirmInverted: z.boolean().default(false),
});

export const modelPricingUpdateSchema = modelPricingCreateSchema
  .extend({ confirmInverted: z.boolean().optional() })
  .partial();

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
  sortOrder: z.number().int().default(0),
  confirmInverted: z.boolean().default(false),
});

export const codingPlanUpdateSchema = codingPlanCreateSchema
  .extend({ confirmInverted: z.boolean().optional() })
  .partial();

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
  sortOrder: number;
}) {
  return {
    id: row.id.toString(),
    vendor: row.vendor,
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
    sortOrder: row.sortOrder,
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
  });
  return rows.map(serializeModelRow);
}

export async function createModelPricing(input: ModelPricingCreateInput): Promise<ModelPricingRow> {
  assertNotInverted(input.inputPrice, input.outputPrice, input.confirmInverted);
  const { confirmInverted: _confirm, ...data } = input;
  const row = await prisma.modelPricing.create({ data });
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
  return serializeModelRow(row);
}

export async function deleteModelPricing(id: bigint): Promise<void> {
  await prisma.modelPricing.delete({ where: { id } });
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
  return serializePlanRow(row);
}

export async function deleteCodingPlan(id: bigint): Promise<void> {
  await prisma.codingPlan.delete({ where: { id } });
}
