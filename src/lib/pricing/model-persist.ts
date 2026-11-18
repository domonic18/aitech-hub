/**
 * 模型面(按量牌价)落库(M74 批B):归一关联 + 价格档位 + 免费判定 + 墓碑。
 *
 * 从 crawlers.ts 拆出:落库逻辑含归一(get-or-create)、档位写入、免费判定、
 * 下线墓碑,已超单文件长度上限;解析器留在 crawlers.ts。
 *
 * 三条口径:
 * - **归一**:厂商与模型的 get-or-create 走 model-registry 唯一出口;厂商认不出
 *   → provider_id 留 null(不猜),模型键归一后为空 → 整行跳过(不落脏行)
 * - **档位**:源解析出阶梯/缓存/峰谷/模态计价时写 model_pricing_tier(整行替换);
 *   没解析出就不写——行上的两价仍是该行的事实,档位是补充而非替代
 * - **免费**:完全免费 = 行价与所有档位价全为 0;缺价(null=未公布)不当免费;
 *   与 free_tier「有免费额度」是两种语义,分开
 */
import { prisma } from "@/lib/db";

import { persistCuratedRows, markCuratedSourceStale } from "./curated-persist";
import { buildChangeRowData } from "./change-log";
import type { PriceSnapshot } from "./change";
import { isFreePrices, isFreeTiers, type PriceSet } from "./rules";
import { getOrCreateModel, getOrCreateProvider } from "./model-registry";
import { PROVIDER_SEEDS, providerKeyForVendor } from "./provider-registry";
import { replaceTiers } from "./tiers";
import type { ModelPrefillRow, ModelTierPrefill } from "./crawlers";

/** 档位价 → 判定形状 */
function tierPriceSet(tier: ModelTierPrefill): PriceSet {
  return {
    inputPrice: tier.inputPrice,
    outputPrice: tier.outputPrice,
    cachePrice: tier.cachePrice,
  };
}

/**
 * 完全免费判定:行价 + 全部档位价都必须是 0(缺价不当免费)。
 * 档位里 null 价视为「该档不适用」,不参与判定;但每个参与判定的价组
 * 至少要有一个非 null 价,否则该组信息不足(不判免费)。
 */
export function isFreeModelRow(row: ModelPrefillRow): boolean {
  const sets: PriceSet[] = [];
  if (row.tiers !== undefined && row.tiers.length > 0) {
    sets.push(...row.tiers.map(tierPriceSet));
  }
  sets.push({ inputPrice: row.inputPrice, outputPrice: row.outputPrice });
  if (sets.length === 1) return isFreePrices(sets[0]!);
  return isFreeTiers(sets);
}

/** 厂商规范键:行内显式给 > vendor 映射;认不出返回 null(不猜厂商) */
function resolveProviderKey(row: ModelPrefillRow): string | null {
  if (row.providerKey !== undefined && row.providerKey !== "") return row.providerKey;
  return providerKeyForVendor(row.vendor);
}

/**
 * 厂商归一:规范键 → 厂商字典 id。
 * 键不在种子表里 → 返回 null(不凭空造厂商行)。
 */
async function resolveProviderId(row: ModelPrefillRow): Promise<bigint | null> {
  const key = resolveProviderKey(row);
  if (key === null) return null;
  const seed = PROVIDER_SEEDS.find((s) => s.key === key);
  if (seed === undefined) return null;
  const provider = await getOrCreateProvider(seed);
  return provider.id;
}

/** 模型归一:原始模型键 → 模型字典 id;归一后为空 → null(整行跳过)。
 *  行内源显式模态标注随之传入——getOrCreateModel 内部归并并做 text→非text 升级 */
async function resolveModelId(row: ModelPrefillRow): Promise<bigint | null> {
  try {
    const model = await getOrCreateModel({ rawKey: row.modelKey, modality: row.modality });
    return model.id;
  } catch {
    return null; // 模型键归一后为空:不落脏行
  }
}

/** 档位写入(行内无档位则不写档位行) */
async function writeTiers(modelPricingId: bigint, row: ModelPrefillRow): Promise<void> {
  if (row.tiers === undefined || row.tiers.length === 0) return;
  await replaceTiers(
    modelPricingId,
    row.tiers.map((t) => ({
      tierLabel: t.tierLabel,
      inputPrice: t.inputPrice,
      outputPrice: t.outputPrice,
      cachePrice: t.cachePrice,
      minTokens: t.minTokens,
      maxTokens: t.maxTokens,
      unit: t.unit,
      currency: row.currency,
      dataAsOf: row.dataAsOf,
      sourceUrl: row.sourceUrl,
    })),
  );
}

/**
 * 模型行落库(建 pending / 可刷新行刷新 / 人工定稿行不动;currency 随价格走;
 * M74 起附带归一 id、免费标识与档位)。
 *
 * **批F 变更留痕**:刷新行时对比库中现值,变了就在同一事务里多写一行
 * `model_pricing_change`。取旧价靠 `listExisting` 的 select(顺带把旧价收进
 * 闭包),不动通用编排 `curated-persist.ts` 的接口(套餐面共用,改了会波及)。
 */
export async function persistModelRows(
  rows: ModelPrefillRow[],
  opts?: { sourceKey?: string; now?: Date },
): Promise<{
  created: number;
  refreshed: number;
  untouched: number;
  failed: number;
}> {
  // 旧价快照:键必须精确到 vendor|modelKey——listExisting 的 where 是
  // vendor×modelKey 笛卡尔积,只按 vendor 取会张冠李戴
  const oldByKey = new Map<string, PriceSnapshot>();
  const sourceKey = opts?.sourceKey ?? null;
  const changedAt = opts?.now ?? new Date();

  return persistCuratedRows(rows, {
    keyOf: (r) => ({ vendor: r.vendor, key: r.modelKey }),
    listExisting: async (vendors, keys) => {
      const existing = await prisma.modelPricing.findMany({
        where: { vendor: { in: vendors }, modelKey: { in: keys } },
        select: {
          id: true,
          vendor: true,
          modelKey: true,
          status: true,
          isPinned: true,
          currency: true,
          inputPrice: true,
          outputPrice: true,
          priceUnit: true,
        },
      });
      for (const r of existing) {
        oldByKey.set(`${r.vendor}|${r.modelKey}`, {
          currency: r.currency,
          priceUnit: r.priceUnit,
          inputPrice: r.inputPrice === null ? null : Number(r.inputPrice),
          outputPrice: r.outputPrice === null ? null : Number(r.outputPrice),
        });
      }
      return existing.map((r) => ({
        id: r.id,
        vendor: r.vendor,
        key: r.modelKey,
        status: r.status,
        isPinned: r.isPinned,
      }));
    },
    create: async (r) => {
      const providerId = await resolveProviderId(r);
      const modelId = await resolveModelId(r);
      const created = await prisma.modelPricing.create({
        data: {
          vendor: r.vendor,
          modelKey: r.modelKey,
          currency: r.currency,
          inputPrice: r.inputPrice,
          outputPrice: r.outputPrice,
          contextWindow: r.contextWindow,
          note: r.note,
          freeTier: r.freeTier ?? null,
          dataAsOf: r.dataAsOf,
          sourceUrl: r.sourceUrl,
          region: r.region,
          status: "pending",
          providerId,
          modelId,
          isFree: isFreeModelRow(r),
          priceUnit: r.priceUnit ?? "per_1m_tokens",
        },
        select: { id: true },
      });
      await writeTiers(created.id, r);
      return created;
    },
    update: async (id: bigint, r) => {
      const providerId = await resolveProviderId(r);
      const modelId = await resolveModelId(r);
      const newSnap: PriceSnapshot = {
        currency: r.currency,
        priceUnit: r.priceUnit ?? "per_1m_tokens",
        inputPrice: r.inputPrice,
        outputPrice: r.outputPrice,
      };
      const oldSnap = oldByKey.get(`${r.vendor}|${r.modelKey}`);
      // 批F:变了就多写一行变更史(与改价同一事务,避免「价改了史没写」)
      const changeRow =
        oldSnap === undefined
          ? null
          : buildChangeRowData({
              modelPricingId: id,
              vendor: r.vendor,
              modelKey: r.modelKey,
              oldSnap,
              newSnap,
              sourceKey,
              sourceUrl: r.sourceUrl,
              changedAt,
            });
      // 改价与写变更史同一事务:价改了史没写,或史写了价没改,都是脏态
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.modelPricing.update({
          where: { id },
          data: {
            // currency 必须随价格走:行若由 USD 通道先建,官方 CNY 价刷新时
            // 币种同步矫正,杜绝「¥ 数字配 $ 符号」的跨通道脏态
            currency: r.currency,
            inputPrice: r.inputPrice,
            outputPrice: r.outputPrice,
            contextWindow: r.contextWindow,
            note: r.note,
            freeTier: r.freeTier ?? null,
            dataAsOf: r.dataAsOf,
            sourceUrl: r.sourceUrl,
            providerId,
            modelId,
            isFree: isFreeModelRow(r),
            priceUnit: r.priceUnit ?? "per_1m_tokens",
          },
          select: { id: true },
        });
        if (changeRow !== null) {
          await tx.modelPricingChange.create({ data: changeRow, select: { id: true } });
        }
        return u;
      });
      await writeTiers(id, r);
      return updated;
    },
  });
}

/**
 * 墓碑阈值:行在该时长内没被刷新(= 采集没再解析到它)即判为「源已下线」。
 * 模型面日级采集 → 3 天没出现即墓碑;人工定稿行不参与(永不刷新)。
 */
export const PRICING_TOMBSTONE_STALE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 失败源旧数据整源打标(「待复核」;通用编排薄壳,圈定/写入口径见 curated-persist)。
 * 只动 note 不动状态——enabled 行仍页面可见,但策展台能看见「需人工复核」。
 */
export async function markModelSourceStale(sourceUrl: string, now: Date): Promise<number> {
  return markCuratedSourceStale(
    sourceUrl,
    now,
    (url) =>
      prisma.modelPricing.findMany({ where: { sourceUrl: url }, select: { id: true, note: true } }),
    (id, note) =>
      prisma.modelPricing.update({ where: { id }, data: { note }, select: { id: true } }),
  );
}

/**
 * 下线墓碑:成功采集后,本源已连续多轮未出现的行 → 停用 + 打「源已下线」注记。
 *
 * 判据用 data_as_of(每次成功刷新都会推后它):老到超过阈值的行 = 这轮没被
 * 解析到。人工定稿行(is_pinned)永不刷新,不参与墓碑。
 * **只在采集成功且本次解析出 ≥1 行时调用**——源失败/解析空时所有行都老,
 * 会被整源误杀(失败路径另有「待复核」打标)。
 */
export async function markMissingModelsStale(
  sourceUrl: string,
  now: Date,
  staleMs: number,
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleMs);
  const rows = await prisma.modelPricing.findMany({
    where: {
      sourceUrl,
      isPinned: false,
      status: { not: "disabled" },
      dataAsOf: { lt: cutoff },
    },
    select: { id: true, note: true },
  });
  for (const row of rows) {
    const note = `${row.note ?? ""}`.includes("源已下线")
      ? (row.note ?? "")
      : `【源已下线 ${now.toISOString().slice(0, 10)}】${row.note ?? ""}`.slice(0, 200);
    await prisma.modelPricing.update({
      where: { id: row.id },
      data: { status: "disabled", note },
    });
  }
  return rows.length;
}
