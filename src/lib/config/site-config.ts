/**
 * 站点配置 kv 读/写侧(M10 批②):首页电报带条数等站点级运行参数。
 * 读侧一律 prerenderSafe 包裹(构建期无 DB 回落默认值,arch/07 §1);
 * 写侧仅供 admin API;键名合法值在此登记(同枚举字段应用层管控纪律)。
 */
import { z } from "zod";

import { prisma } from "../db";
import { prerenderSafe } from "../prerender-safe";
import { DEFAULT_BAND_ITEM_COUNT } from "../telegram/feed-view";

/** 配置键登记表(新增配置键在此加一行,消费方经常量取键) */
export const SITE_CONFIG_KEYS = {
  bandItemCount: "band.item_count",
} as const;

const BAND_ITEM_COUNT_MIN = 1;
const BAND_ITEM_COUNT_MAX = 50;

/** PUT /api/site-config 请求体(整数 1..50) */
export const SiteConfigUpdateSchema = z.object({
  bandItemCount: z.number().int().min(BAND_ITEM_COUNT_MIN).max(BAND_ITEM_COUNT_MAX),
});

const clampBandItemCount = (n: number): number =>
  Math.min(
    Math.max(Math.trunc(n) || DEFAULT_BAND_ITEM_COUNT, BAND_ITEM_COUNT_MIN),
    BAND_ITEM_COUNT_MAX,
  );

/** 首页电报带条数(缺行/库值非数 → 默认 12;越界 → clamp;构建期无库 → 默认) */
export async function getBandItemCount(): Promise<number> {
  return prerenderSafe("site_config.bandItemCount", DEFAULT_BAND_ITEM_COUNT, async () => {
    const row = await prisma.siteConfig.findUnique({
      where: { key: SITE_CONFIG_KEYS.bandItemCount },
      select: { value: true },
    });
    if (!row) return DEFAULT_BAND_ITEM_COUNT;
    return clampBandItemCount(Number(row.value));
  });
}

/** 保存带条数(upsert 幂等;越界由 Zod 校验先行拒绝) */
export async function setBandItemCount(value: number): Promise<void> {
  const n = SiteConfigUpdateSchema.parse({ bandItemCount: value }).bandItemCount;
  await prisma.siteConfig.upsert({
    where: { key: SITE_CONFIG_KEYS.bandItemCount },
    update: { value: String(n) },
    create: { key: SITE_CONFIG_KEYS.bandItemCount, value: String(n) },
  });
}
