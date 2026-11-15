/**
 * 牌价价格档位读写(M74 批A,库侧)。
 *
 * 为什么要有档位表:一行两价承载不了真实定价——阶梯价(千问按上下文分档)、
 * 缓存价(DeepSeek 命中/未命中)、峰谷价(空闲/高峰)、模态计价(按张/秒/分钟)
 * 全都压成两个 decimal 就是在说谎(R2「爬取结果还比较简单」的根因)。
 *
 * 粒度 = **一条牌价行内的某个档位**:同一模型不同提供商的档位结构不同
 * (有的分上下文档、有的分时段),所以档位挂在行上,不在模型上。
 */
import { prisma } from "@/lib/db";

/** 档位入参 */
export interface TierInput {
  /** 档位名(行内唯一):默认 / 缓存命中 / ≤32k / 峰段 09:00-23:00 */
  tierLabel: string;
  inputPrice?: number | null;
  outputPrice?: number | null;
  cachePrice?: number | null;
  /** 阶梯下界(含) */
  minTokens?: number | null;
  /** 阶梯上界(不含) */
  maxTokens?: number | null;
  /** 计价单位:per_1m_tokens / per_1k_tokens / per_image / per_second / per_minute */
  unit?: string | null;
  /** 币种(CNY | USD,随价格走) */
  currency: string;
  /** 数据截稿 */
  dataAsOf: Date;
  /** 溯源页 */
  sourceUrl: string;
  note?: string | null;
}

/** 档位读出行 */
export interface TierRow {
  modelPricingId: bigint;
  tierLabel: string;
  inputPrice: number | null;
  outputPrice: number | null;
  cachePrice: number | null;
  minTokens: number | null;
  maxTokens: number | null;
  unit: string;
  currency: string;
  dataAsOf: Date;
  sourceUrl: string;
  note: string | null;
}

const UNIT_DEFAULT = "per_1m_tokens";

/**
 * 整行档位替换(采集落库口径:档位集合按源整批刷新,不在行内做增量合并)——
 * 删旧建新,单事务。返回写入档位数。
 */
export async function replaceTiers(modelPricingId: bigint, tiers: TierInput[]): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.modelPricingTier.deleteMany({ where: { modelPricingId } });
    if (tiers.length === 0) return 0;
    const result = await tx.modelPricingTier.createMany({
      data: tiers.map((t) => ({
        modelPricingId,
        tierLabel: t.tierLabel,
        inputPrice: t.inputPrice ?? null,
        outputPrice: t.outputPrice ?? null,
        cachePrice: t.cachePrice ?? null,
        minTokens: t.minTokens ?? null,
        maxTokens: t.maxTokens ?? null,
        unit: t.unit ?? UNIT_DEFAULT,
        currency: t.currency,
        dataAsOf: t.dataAsOf,
        sourceUrl: t.sourceUrl,
        note: t.note ?? null,
      })),
    });
    return result.count;
  });
}

/** 批量读档位(读侧一次性取回,避免 N+1) */
export async function readTiers(modelPricingIds: bigint[]): Promise<Map<string, TierRow[]>> {
  const out = new Map<string, TierRow[]>();
  if (modelPricingIds.length === 0) return out;
  const rows = await prisma.modelPricingTier.findMany({
    where: { modelPricingId: { in: modelPricingIds } },
    orderBy: [{ modelPricingId: "asc" }, { tierLabel: "asc" }],
  });
  for (const r of rows) {
    const key = r.modelPricingId.toString();
    const list = out.get(key);
    const row: TierRow = {
      modelPricingId: r.modelPricingId,
      tierLabel: r.tierLabel,
      inputPrice: r.inputPrice === null ? null : Number(r.inputPrice),
      outputPrice: r.outputPrice === null ? null : Number(r.outputPrice),
      cachePrice: r.cachePrice === null ? null : Number(r.cachePrice),
      minTokens: r.minTokens,
      maxTokens: r.maxTokens,
      unit: r.unit,
      currency: r.currency,
      dataAsOf: r.dataAsOf,
      sourceUrl: r.sourceUrl,
      note: r.note,
    };
    if (list === undefined) out.set(key, [row]);
    else list.push(row);
  }
  return out;
}
