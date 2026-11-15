/**
 * 牌价域价格语义判定(M74 批A,纯函数·零库依赖零 env)。
 *
 * 「免费」在本域有两个语义,必须分开(裁定第 7 条):
 * - **完全免费**:`is_free` 布尔——所有档位价均为 0,调用不花钱;
 * - **有免费额度**:`free_tier` 自由文本(如「每日 200 万 tokens 免费」),
 *   官方原文直出,不是完全免费。
 * 两者混成一个「免费」角标就是误导——本文件只负责前者。
 *
 * 判定口径(禁臆测):
 * - 缺价(null)不当免费——「未公布」≠「0 元」;
 * - 档位里 null 价视为「该档不适用」,不参与判定;但每个参与判定的档位
 *   至少要有一个非 null 价,否则该档本身信息不足。
 */

/** 参与判定的价格集合(行价或档位价同一形状) */
export interface PriceSet {
  inputPrice: number | null;
  outputPrice: number | null;
  cachePrice?: number | null;
}

function priceValues(prices: PriceSet): number[] {
  const out: number[] = [];
  if (prices.inputPrice !== null) out.push(prices.inputPrice);
  if (prices.outputPrice !== null) out.push(prices.outputPrice);
  if (prices.cachePrice !== undefined && prices.cachePrice !== null) out.push(prices.cachePrice);
  return out;
}

/** 单组价格是否「全零且有价」 */
export function isFreePrices(prices: PriceSet): boolean {
  const values = priceValues(prices);
  if (values.length === 0) return false;
  return values.every((v) => v === 0);
}

/**
 * 整行是否完全免费:至少一个档位,且每个档位都「全零且有价」。
 * 行价(无档位)场景用 {@link isFreePrices}。
 */
export function isFreeTiers(tiers: PriceSet[]): boolean {
  if (tiers.length === 0) return false;
  return tiers.every((t) => isFreePrices(t));
}
