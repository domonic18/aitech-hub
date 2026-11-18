/**
 * 牌价变更行写入(M74 批F,服务端):把一次采集落库的价格变化落成变更史。
 *
 * ⚠️ 本模块链 `@/lib/db` —— **不得**被客户端组件引(会被 client-graph 守卫拦下)。
 * 判定逻辑在 `./change.ts`(纯函数),这里只负责「把判定结果变成一行库记录」。
 */
import type { Prisma } from "@prisma/client";

import { classifyChange, type PricingChangeKind, type PriceSnapshot } from "./change";

/** 一次变更的完整上下文(落库侧组装) */
export interface PriceChangeContext {
  modelPricingId: bigint;
  vendor: string;
  modelKey: string;
  /** 库里现值(刷新前) */
  oldSnap: PriceSnapshot;
  /** 本次采集解析出的新值 */
  newSnap: PriceSnapshot;
  /** 采集源规范键(SOURCE_DEFS.key);渠道 URL 会被后台改,不能当源标识 */
  sourceKey: string | null;
  sourceUrl: string | null;
  changedAt: Date;
}

/** 变更行数据(未写库):判定为「不该记的事件」时返回 null */
export function buildChangeRowData(
  ctx: PriceChangeContext,
): Prisma.ModelPricingChangeUncheckedCreateInput | null {
  const change = classifyChange(ctx.oldSnap, ctx.newSnap);
  if (change === null) return null;
  return {
    modelPricingId: ctx.modelPricingId,
    vendor: ctx.vendor,
    modelKey: ctx.modelKey,
    oldInputPrice: ctx.oldSnap.inputPrice,
    oldOutputPrice: ctx.oldSnap.outputPrice,
    newInputPrice: ctx.newSnap.inputPrice,
    newOutputPrice: ctx.newSnap.outputPrice,
    oldCurrency: ctx.oldSnap.currency,
    newCurrency: ctx.newSnap.currency,
    oldPriceUnit: ctx.oldSnap.priceUnit,
    newPriceUnit: ctx.newSnap.priceUnit,
    changeKind: change.kind,
    sourceKey: ctx.sourceKey,
    sourceUrl: ctx.sourceUrl,
    changedAt: ctx.changedAt,
  };
}

/** 变更类型(供读侧与展示层复用,避免字符串散落) */
export type { PricingChangeKind };
