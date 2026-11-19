/**
 * 模型牌价·模型面策展写侧(M55 批A):model_pricing 单表的 CRUD 与终审。
 *
 * 爬虫/手工数据均落 pending,enabled=终审可见(disabled=停用下架);
 * 反常态守卫:输入价 > 输出价需 confirmInverted 显式确认(防小数点错位静默发布)。
 * 契约(Zod)在 admin-schema.ts,套餐面在 admin-plan.ts,按源下架在 offline-source.ts。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

import { revalidatePublicPricing } from "./admin-cache";
import type {
  ModelPricingCreateInput,
  ModelPricingTierInput,
  ModelPricingUpdateInput,
  PricingStatus,
} from "./admin-schema";
import { replaceTiers } from "./tiers";

/** 行出参(Decimal→number,BigInt→string;admin 台账与公开页共用形状基座) */
export function serializeModelRow(row: {
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

export type ModelPricingRow = ReturnType<typeof serializeModelRow>;

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
  if (existing === null) return null;
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
 *
 * ⚠️ 人工定稿行(is_pinned)在**下架**时不动:定稿是人工确认过的价,采集失败也不该
 * 被批量动作带走(与按源下架 offline-source.ts 同一口径);上架不受此限。
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
    where: { id: { in: valid }, ...(status === "disabled" ? { isPinned: false } : {}) },
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
