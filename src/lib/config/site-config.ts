/**
 * 站点配置 kv 读/写侧(M10 批② 键 band.item_count;M12 批② 键族扩展:首页
 * rail 条数 ×2/站点标题/hub 主文案 markdown)。读侧一律 prerenderSafe 包裹
 * (构建期无 DB 回落默认值,arch/07 §1);写侧仅供 admin API;键名合法值在
 * 此登记(同枚举字段应用层管控纪律)。value 为 Text(20261004232937 扩列,
 * 容纳 hero_md markdown)。站点标题消费面:metadata/Header/Footer/RSS/
 * llms.txt;admin 控制台内部 UI 不随配置(保持「一起AI 控制台」)。
 */
import { z } from "zod";

import { prisma } from "../db";
import { prerenderSafe } from "../prerender-safe";
import {
  BAND_ITEM_COUNT_MAX,
  BAND_ITEM_COUNT_MIN,
  clampBandItemCount,
  DEFAULT_BAND_ITEM_COUNT,
} from "../telegram/constants";

/** 配置键登记表(新增配置键在此加一行,消费方经常量取键) */
export const SITE_CONFIG_KEYS = {
  bandItemCount: "band.item_count",
  repoCount: "home.repo_count",
  postCount: "home.post_count",
  siteTitle: "site.title",
  heroMd: "home.hero_md",
  aboutMd: "about.content",
} as const;

/** 站点标题缺省(品牌 2026-10-02 定稿;配置缺省/空值时全站回退) */
export const DEFAULT_SITE_TITLE = "一起AI";

/** 首页 rail 卡条数合法域(开源项目卡/博主文章卡同钳) */
export const RAIL_COUNT_MIN = 1;
export const RAIL_COUNT_MAX = 12;
export const DEFAULT_REPO_COUNT = 3;
export const DEFAULT_POST_COUNT = 5;

/** hub 主文案 markdown 上限(前台空值回退内置文案) */
export const HERO_MD_MAX = 2000;
/** 关于页内容 markdown 上限(空值回退内置默认文案,与 hero_md 同兜底模式) */
export const ABOUT_MD_MAX = 8000;
const SITE_TITLE_MAX = 50;

// ── 读侧 ──────────────────────────────────────────────────────

/** 单键读值(构建期无库/缺行 → null,由各键解析器回落) */
async function readConfigValue(key: string): Promise<string | null> {
  return prerenderSafe(`site_config.${key}`, null, async () => {
    const row = await prisma.siteConfig.findUnique({ where: { key }, select: { value: true } });
    return row?.value ?? null;
  });
}

/** 整数键解析:缺行/非整数/低于下限 → 默认;超上限 → clamp(band 条数同口径) */
function parseIntConfig(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (raw === null || !Number.isInteger(n) || n < min) return fallback;
  return Math.min(max, n);
}

/** 首页电报带条数(缺行/非数 → 默认 12;越界 → clamp 1..50) */
export async function getBandItemCount(): Promise<number> {
  const raw = await readConfigValue(SITE_CONFIG_KEYS.bandItemCount);
  return raw === null ? DEFAULT_BAND_ITEM_COUNT : clampBandItemCount(Number(raw));
}

/** 首页开源项目卡条数(1..12,默认 3) */
export async function getRepoCount(): Promise<number> {
  return parseIntConfig(
    await readConfigValue(SITE_CONFIG_KEYS.repoCount),
    DEFAULT_REPO_COUNT,
    RAIL_COUNT_MIN,
    RAIL_COUNT_MAX,
  );
}

/** 首页博主文章卡条数(1..12,默认 5) */
export async function getPostCount(): Promise<number> {
  return parseIntConfig(
    await readConfigValue(SITE_CONFIG_KEYS.postCount),
    DEFAULT_POST_COUNT,
    RAIL_COUNT_MIN,
    RAIL_COUNT_MAX,
  );
}

/** 站点标题(空/缺省 → 「一起AI」;消费方不再各自硬编码) */
export async function getSiteTitle(): Promise<string> {
  const t = (await readConfigValue(SITE_CONFIG_KEYS.siteTitle))?.trim();
  return t ? t : DEFAULT_SITE_TITLE;
}

/** hub 主文案 markdown(空/缺省 → 空串,前台回退内置文案) */
export async function getHeroMd(): Promise<string> {
  return ((await readConfigValue(SITE_CONFIG_KEYS.heroMd)) ?? "").trim();
}

/** 全量设置(admin 页与 GET API 共用;单次 findMany,构建期 → 全默认) */
export interface SiteSettings {
  bandItemCount: number;
  repoCount: number;
  postCount: number;
  siteTitle: string;
  heroMd: string;
  aboutMd: string;
}

export async function getSiteSettings(): Promise<SiteSettings> {
  return prerenderSafe(
    "site_config.all",
    {
      bandItemCount: DEFAULT_BAND_ITEM_COUNT,
      repoCount: DEFAULT_REPO_COUNT,
      postCount: DEFAULT_POST_COUNT,
      siteTitle: DEFAULT_SITE_TITLE,
      heroMd: "",
      aboutMd: "",
    },
    async () => {
      const rows = await prisma.siteConfig.findMany({
        where: { key: { in: Object.values(SITE_CONFIG_KEYS) } },
        select: { key: true, value: true },
      });
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      const bandRaw = byKey.get(SITE_CONFIG_KEYS.bandItemCount) ?? null;
      return {
        bandItemCount:
          bandRaw === null ? DEFAULT_BAND_ITEM_COUNT : clampBandItemCount(Number(bandRaw)),
        repoCount: parseIntConfig(
          byKey.get(SITE_CONFIG_KEYS.repoCount) ?? null,
          DEFAULT_REPO_COUNT,
          RAIL_COUNT_MIN,
          RAIL_COUNT_MAX,
        ),
        postCount: parseIntConfig(
          byKey.get(SITE_CONFIG_KEYS.postCount) ?? null,
          DEFAULT_POST_COUNT,
          RAIL_COUNT_MIN,
          RAIL_COUNT_MAX,
        ),
        siteTitle: byKey.get(SITE_CONFIG_KEYS.siteTitle)?.trim() || DEFAULT_SITE_TITLE,
        heroMd: (byKey.get(SITE_CONFIG_KEYS.heroMd) ?? "").trim(),
        aboutMd: (byKey.get(SITE_CONFIG_KEYS.aboutMd) ?? "").trim(),
      };
    },
  );
}

// ── 写侧 ──────────────────────────────────────────────────────

/** PUT /api/site-config 请求体(全键可选 partial;siteTitle trim 后须非空) */
export const SiteConfigUpdateSchema = z.object({
  bandItemCount: z.number().int().min(BAND_ITEM_COUNT_MIN).max(BAND_ITEM_COUNT_MAX).optional(),
  repoCount: z.number().int().min(RAIL_COUNT_MIN).max(RAIL_COUNT_MAX).optional(),
  postCount: z.number().int().min(RAIL_COUNT_MIN).max(RAIL_COUNT_MAX).optional(),
  siteTitle: z.string().trim().min(1).max(SITE_TITLE_MAX).optional(),
  heroMd: z.string().max(HERO_MD_MAX).optional(),
  aboutMd: z.string().max(ABOUT_MD_MAX).optional(),
});

export type SiteConfigUpdateInput = z.infer<typeof SiteConfigUpdateSchema>;

/** 保存(partial 多键一次事务 upsert;越界/非法由 Zod 先行拒绝) */
export async function setSiteConfig(input: SiteConfigUpdateInput): Promise<void> {
  const data = SiteConfigUpdateSchema.parse(input);
  const rows: Array<{ key: string; value: string }> = [];
  if (data.bandItemCount !== undefined) {
    rows.push({ key: SITE_CONFIG_KEYS.bandItemCount, value: String(data.bandItemCount) });
  }
  if (data.repoCount !== undefined) {
    rows.push({ key: SITE_CONFIG_KEYS.repoCount, value: String(data.repoCount) });
  }
  if (data.postCount !== undefined) {
    rows.push({ key: SITE_CONFIG_KEYS.postCount, value: String(data.postCount) });
  }
  if (data.siteTitle !== undefined) {
    rows.push({ key: SITE_CONFIG_KEYS.siteTitle, value: data.siteTitle });
  }
  if (data.heroMd !== undefined) {
    rows.push({ key: SITE_CONFIG_KEYS.heroMd, value: data.heroMd });
  }
  if (data.aboutMd !== undefined) {
    rows.push({ key: SITE_CONFIG_KEYS.aboutMd, value: data.aboutMd });
  }
  if (rows.length === 0) return;
  await prisma.$transaction(
    rows.map((r) =>
      prisma.siteConfig.upsert({ where: { key: r.key }, update: { value: r.value }, create: r }),
    ),
  );
}
