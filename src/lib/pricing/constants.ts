/**
 * 牌价域共享常量(M74 批C2):**纯常量、零依赖**。
 *
 * 为什么单独成文件:客户端组件(如后台档位编辑器)也要用这些常量,而
 * `admin.ts` 链到 prisma——从它 import 值会把 prisma 打进 client bundle
 * (SSR 期炸「PrismaClient is unable to run in this browser environment")。
 * 类型可用 `import type` 引入(编译期擦除),**值**必须走这里。
 */

/** 档位计价单位(与 model_pricing_tier.unit 同口径) */
export const TIER_UNITS = [
  "per_1m_tokens",
  "per_1k_tokens",
  "per_image",
  "per_second",
  "per_minute",
] as const;

export type TierUnit = (typeof TIER_UNITS)[number];

/** 档位单位的中文标签(后台展示) */
export const TIER_UNIT_LABELS: Record<TierUnit, string> = {
  per_1m_tokens: "每百万 tokens",
  per_1k_tokens: "每千 tokens",
  per_image: "每张图",
  per_second: "每秒",
  per_minute: "每分钟",
};
