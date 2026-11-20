/**
 * 牌价计价单位归一(纯函数、零依赖、零 env):token 系一律「元/百万 tokens」。
 *
 * 为什么必须归一:源页有的按「元/K token」报价(火山方舟表头写「元/K token」),
 * 有的按「元/M token」。两个口径的数字放进同一列(列头/比价区/JSON-LD 都只写
 * 「每百万 tokens」)会差 1000 倍——元/K 的 0.8 与元/M 的 0.8 不是一个东西。
 * 口径只在这一处归一,别处各写一份必然漂移。
 *
 * 两个出口用同一份口径:
 * - 写侧(model-persist):落库前把 per_1k 行的价 ×1000、单位改 per_1m;
 * - 读侧(read.ts):存量 per_1k 行按同口径换算(回填前的过渡,页面不出错价)。
 */

/** token 系的统一口径:每百万 tokens */
export const TOKEN_UNIT = "per_1m_tokens";

/** token 系单位(双价语义:输入价 + 输出价);其余是单价格(生成价)语义 */
export function isTokenUnit(unit: string): boolean {
  return unit === "per_1m_tokens" || unit === "per_1k_tokens";
}

/** 归一到「元/百万 tokens」的换算系数(per_1k → ×1000;其余 1) */
export function tokenUnitFactor(unit: string): number {
  return unit === "per_1k_tokens" ? 1000 : 1;
}

/** 归一后的单位(token 系 → per_1m_tokens;非 token 单位原样) */
export function normalizedUnit(unit: string): string {
  return isTokenUnit(unit) ? TOKEN_UNIT : unit;
}

/** 单价换算到「元/百万 tokens」口径(null = 未公布,原样) */
export function toPerMillion(price: number | null, unit: string): number | null {
  if (price === null) return null;
  return price * tokenUnitFactor(unit);
}
