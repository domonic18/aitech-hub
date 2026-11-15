/**
 * 牌价字典注册表(M74 批A,库侧):厂商/模型的 get-or-create 与厂商种子幂等种入。
 *
 * 归一**唯一出口**在本模块:调用方给原始模型键,由这里算出 model_key /
 * match_key 并落库——避免各处各算一套、字典漂移(同 CLAUDE.md 对 slug 的
 * 「构造/解析唯一出口」纪律)。
 *
 * 并发:get-or-create 走「先查后建 + 唯一冲突回读」,不依赖事务串行化
 * (同 insight 实体层的 get-or-create 口径);唯一冲突(P2002)时回读既有行。
 */
import { isP2002, prisma } from "@/lib/db";

import {
  deriveFamily,
  displayNameFromModelKey,
  normalizeMatchKey,
  normalizeModelKey,
} from "./normalize";
import { PROVIDER_SEEDS, type ProviderSeed } from "./provider-registry";

/** 厂商字典行(只取用得到的字段) */
export interface ProviderRef {
  id: bigint;
  key: string;
  name: string;
  sourceKind: string;
  region: string;
}

/** 模型字典行 */
export interface ModelRef {
  id: bigint;
  modelKey: string;
  matchKey: string;
  displayName: string;
  family: string | null;
  modality: string;
}

/** 厂商 get-or-create(按规范键唯一);已存在则原样返回(不覆盖人工改动) */
export async function getOrCreateProvider(seed: ProviderSeed): Promise<ProviderRef> {
  const existing = await prisma.modelPricingProvider.findUnique({
    where: { key: seed.key },
    select: { id: true, key: true, name: true, sourceKind: true, region: true },
  });
  if (existing !== null) return existing;
  try {
    return await prisma.modelPricingProvider.create({
      data: {
        key: seed.key,
        name: seed.name,
        region: seed.region,
        sourceKind: seed.sourceKind,
        homepageUrl: seed.homepageUrl,
        displayOrder: seed.displayOrder,
      },
      select: { id: true, key: true, name: true, sourceKind: true, region: true },
    });
  } catch (e) {
    if (!isP2002(e)) throw e;
    const again = await prisma.modelPricingProvider.findUnique({
      where: { key: seed.key },
      select: { id: true, key: true, name: true, sourceKind: true, region: true },
    });
    if (again === null) throw e;
    return again;
  }
}

/** 按规范键取厂商;不存在返回 null(不建) */
export async function findProviderByKey(key: string): Promise<ProviderRef | null> {
  return prisma.modelPricingProvider.findUnique({
    where: { key },
    select: { id: true, key: true, name: true, sourceKind: true, region: true },
  });
}

/** 模型字典入参(原始键 + 可选补充属性) */
export interface ModelDictInput {
  /** 原始模型标识(采集页原文,如 `Qwen/Qwen3-235B-A22B`) */
  rawKey: string;
  /** 展示名;缺省取原文去厂商前缀 */
  displayName?: string | null;
  /** 产品线;缺省按 model_key 推导 */
  family?: string | null;
  /** 模态(text / text+vision / image / …);缺省 text */
  modality?: string | null;
}

/**
 * 模型 get-or-create:按 model_key 或 match_key 任一命中即复用既有行
 * (同一模型的快照版本共享一条字典行),否则新建。
 */
export async function getOrCreateModel(input: ModelDictInput): Promise<ModelRef> {
  const modelKey = normalizeModelKey(input.rawKey);
  if (modelKey === "") throw new Error("模型键归一后为空(不可落库)");
  const matchKey = normalizeMatchKey(input.rawKey);
  const displayName =
    input.displayName?.trim() !== undefined && input.displayName?.trim() !== ""
      ? (input.displayName as string).trim()
      : displayNameFromModelKey(input.rawKey) || modelKey;
  const family = input.family ?? deriveFamily(modelKey);
  const modality =
    input.modality?.trim() !== undefined && input.modality?.trim() !== ""
      ? (input.modality as string).trim()
      : "text";

  const select = {
    id: true,
    modelKey: true,
    matchKey: true,
    displayName: true,
    family: true,
    modality: true,
  } as const;

  const existing = await prisma.modelPricingModel.findFirst({
    where: { OR: [{ modelKey }, { matchKey }] },
    select,
  });
  if (existing !== null) return existing;

  try {
    return await prisma.modelPricingModel.create({
      data: { modelKey, matchKey, displayName, family, modality },
      select,
    });
  } catch (e) {
    if (!isP2002(e)) throw e;
    const again = await prisma.modelPricingModel.findFirst({
      where: { OR: [{ modelKey }, { matchKey }] },
      select,
    });
    if (again === null) throw e;
    return again;
  }
}

/**
 * 厂商种子幂等种入(worker 启动调用):**只补缺不改值**——
 * 名称/排序/官网归后台与人工维护,启动种子不覆盖(同 syncPricingChannels 纪律)。
 * 返回新建条数。
 */
export async function syncPricingProviders(): Promise<number> {
  let created = 0;
  for (const seed of PROVIDER_SEEDS) {
    const found = await prisma.modelPricingProvider.findUnique({
      where: { key: seed.key },
      select: { id: true },
    });
    if (found !== null) continue;
    await prisma.modelPricingProvider.create({
      data: {
        key: seed.key,
        name: seed.name,
        region: seed.region,
        sourceKind: seed.sourceKind,
        homepageUrl: seed.homepageUrl,
        displayOrder: seed.displayOrder,
      },
    });
    created += 1;
  }
  return created;
}
