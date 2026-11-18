/**
 * 牌价变更史公开读侧(M74 批F,服务端):前台「降价了」视图的数据源。
 *
 * ⚠️ 本模块链 `@/lib/db` —— 只在服务端(RSC/Route Handler)引。
 *
 * 口径:
 * - **只外露 enabled 行**:采集落的是 pending、停用的是 disabled,未终审的
 *   牌价与已下架模型的变更史都不该出现在公开页。
 * - **只取降价(changeKind='drop')**:跨币种/跨计价单位的口径变更不可比,
 *   记在库里但不当降价展示。
 * - **近 N 天窗口 + 条数上限**:降价史是「近期动态」,不是全量档案。
 */
import { prisma } from "@/lib/db";
import { prerenderSafe } from "@/lib/prerender-safe";

import { representativePrice } from "./public";
import { SOURCE_DEFS } from "./source-registry";

/** 默认窗口(天)与条数上限 */
export const PRICE_CHANGE_WINDOW_DAYS = 90;
export const PRICE_CHANGE_MAX_ITEMS = 100;

/** 一条公开的降价记录 */
export interface PublicPriceChange {
  id: string;
  /** 厂商/供应方(聚合源回落行内 vendor,如「词元所·博川科技」) */
  providerName: string;
  vendor: string;
  modelKey: string;
  currency: string;
  priceUnit: string;
  oldInputPrice: number | null;
  oldOutputPrice: number | null;
  newInputPrice: number | null;
  newOutputPrice: number | null;
  /** 降幅百分比(正数=降了几成;旧价为 0 → null) */
  dropPct: number | null;
  /** 变更日(YYYY-MM-DD,北京日界) */
  changedAt: string;
  sourceUrl: string | null;
  /** 采集渠道标签(如「百度词元所 聚合报价」) */
  sourceLabel: string | null;
}

export interface PublicPriceChanges {
  items: PublicPriceChange[];
  /** 窗口内降价总条数(可能大于 items.length——超出上限被截断) */
  total: number;
}

/** 北京日界取 YYYY-MM-DD(与 read.ts 的 cnAsOfDay 同口径) */
function cnDay(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/** 采集渠道标签(源规范键 → 注册表展示名;认不出就不显示标签) */
function sourceLabelOf(sourceKey: string | null): string | null {
  if (sourceKey === null || sourceKey === "") return null;
  return SOURCE_DEFS.find((d) => d.key === sourceKey)?.label ?? null;
}

/** 列表读侧(近 N 天降价记录) */
export async function listPublicPriceChanges(opts?: {
  days?: number;
  limit?: number;
  now?: Date;
}): Promise<PublicPriceChanges> {
  const days = opts?.days ?? PRICE_CHANGE_WINDOW_DAYS;
  const limit = opts?.limit ?? PRICE_CHANGE_MAX_ITEMS;
  const now = opts?.now ?? new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const where = {
    changeKind: "drop",
    changedAt: { gte: since },
    pricing: { status: "enabled" },
  } as const;

  return prerenderSafe("pricing.changes", { items: [], total: 0 }, async () => {
    const [rows, total] = await Promise.all([
      prisma.modelPricingChange.findMany({
        where,
        orderBy: { changedAt: "desc" },
        take: limit,
        include: { pricing: { include: { provider: true } } },
      }),
      prisma.modelPricingChange.count({ where }),
    ]);
    const items: PublicPriceChange[] = rows.map((c) => {
      const provider = c.pricing.provider;
      const providerName =
        provider?.sourceKind === "aggregator" ? c.vendor : (provider?.name ?? c.vendor);
      const priceUnit = c.newPriceUnit ?? c.oldPriceUnit ?? "per_1m_tokens";
      const oldRep = representativePrice({
        priceUnit,
        inputPrice: c.oldInputPrice === null ? null : Number(c.oldInputPrice),
        outputPrice: c.oldOutputPrice === null ? null : Number(c.oldOutputPrice),
      });
      const newRep = representativePrice({
        priceUnit,
        inputPrice: c.newInputPrice === null ? null : Number(c.newInputPrice),
        outputPrice: c.newOutputPrice === null ? null : Number(c.newOutputPrice),
      });
      return {
        id: c.id.toString(),
        providerName,
        vendor: c.vendor,
        modelKey: c.modelKey,
        currency: c.newCurrency ?? c.oldCurrency ?? "CNY",
        priceUnit,
        oldInputPrice: c.oldInputPrice === null ? null : Number(c.oldInputPrice),
        oldOutputPrice: c.oldOutputPrice === null ? null : Number(c.oldOutputPrice),
        newInputPrice: c.newInputPrice === null ? null : Number(c.newInputPrice),
        newOutputPrice: c.newOutputPrice === null ? null : Number(c.newOutputPrice),
        dropPct:
          oldRep !== null && oldRep > 0 && newRep !== null
            ? ((oldRep - newRep) / oldRep) * 100
            : null,
        changedAt: cnDay(c.changedAt),
        sourceUrl: c.sourceUrl,
        sourceLabel: sourceLabelOf(c.sourceKey),
      };
    });
    return { items, total };
  });
}
