/**
 * 模型牌价·套餐面策展写侧(M55 批A):coding_plan 单表的 CRUD。
 *
 * 额度口径各家不一,按官方原文呈现不强行归一(套餐字段与展示口径见 arch/03 §2.4)。
 * 契约(Zod)在 admin-schema.ts,模型面在 admin-model.ts,按源下架在 offline-source.ts。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import { revalidatePublicPricing } from "./admin-cache";
import type { CodingPlanCreateInput, CodingPlanUpdateInput, PricingStatus } from "./admin-schema";

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

export type CodingPlanRow = ReturnType<typeof serializePlanRow>;

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
  if (existing === null) return null;
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
