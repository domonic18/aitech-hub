/**
 * 站点配置 kv 读/写侧(M10 批② 键 band.item_count;M12 批② 键族扩展:首页
 * rail 条数 ×2/站点标题/hub 主文案 markdown)。读侧一律 prerenderSafe 包裹
 * (构建期无 DB 回落默认值,arch/07 §1);写侧仅供 admin API;键名合法值在
 * 此登记(同枚举字段应用层管控纪律)。value 为 Text(20261004232937 扩列,
 * 容纳 hero_md markdown)。站点标题消费面:metadata/Header/Footer/RSS/
 * llms.txt;admin 控制台内部 UI 不随配置(保持「一起AI 控制台」)。
 * M70:home.search_terms 存 JSON(首页搜索建议词固定词 + 自动取词个数)。
 */
import { cache } from "react";
import { z } from "zod";

import {
  ABOUT_MD_MAX,
  COPYRIGHT_MD_MAX,
  DEFAULT_SEARCH_TERMS_COUNT,
  SEARCH_TERM_WORD_MAX,
  SEARCH_TERMS_MAX_COUNT,
  SEARCH_TERMS_MAX_WORDS,
  SEARCH_TERMS_MIN_COUNT,
} from "../constants";
import { prisma } from "../db";
import { prerenderSafe } from "../prerender-safe";
import { SITE_NAME } from "../site-meta";
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
  icp: "site.icp",
  /** 文章页文末版权声明(2026-11-01 阅读页优化;纯文本,空 = 不展示)。
   * 缺行(从未配置)→ 内置默认文案;显式存空串 → 整块隐藏 */
  postCopyrightMd: "post.copyright_md",
  /** 首页搜索建议词(M70;JSON:`{words: string[], count: number}`)。
   * words 非空 = 固定词打头,不足 count 用自动热词补齐;words 空 = 全自动取洞察关键词云 */
  homeSearchTerms: "home.search_terms",
  /** 小红书登录态每日探照快照(M50 批F;非配置是遥测——落 kv 免单行新表,
   * 读写仅经 distribute/xhs-probe.ts,不走 settings 页 Zod 解析器) */
  distributeXhsState: "distribute.xhs_state",
} as const;

/** 站点标题缺省(品牌 2026-10-02 定稿;配置缺省/空值时全站回退)。
 * 品牌名的唯一字面量在 lib/site-meta.ts,这里只做别名。 */
export const DEFAULT_SITE_TITLE = SITE_NAME;

/** 首页 rail 卡条数合法域(开源项目卡/博主文章卡同钳) */
export const RAIL_COUNT_MIN = 1;
export const RAIL_COUNT_MAX = 12;
export const DEFAULT_REPO_COUNT = 3;
export const DEFAULT_POST_COUNT = 5;

/** hub 主文案 markdown 上限(前台空值回退内置文案) */
export const HERO_MD_MAX = 2000;
// ABOUT_MD_MAX 住 lib/constants.ts:admin 表单(客户端组件)要用它,不能从这里引
const SITE_TITLE_MAX = 50;
/** ICP 备案号上限(空 = 不展示;页脚链工信部备案系统) */
export const ICP_MAX = 60;

/**
 * 文章页版权声明缺省文案(2026-11-01):旧站全站声明未随迁移入库(迁移只搬
 * post_content),站内唯一可考的同类原文是 154 篇中的一篇(id=124)正文里
 * 自带的一段。用户裁定以此作为缺省,后台可随时在「站点设置 · 文章页」覆盖。
 */
export const DEFAULT_POST_COPYRIGHT_MD = "本项目仅供学习交流使用,原创内容不易,转载请注明出处。";

// ── 首页搜索建议词(M70)─────────────────────────────────────────

/** 首页搜索建议词配置(存 home.search_terms,JSON 文本) */
export interface HomeSearchTermsConfig {
  /** 固定的热词(0-4;空 = 全自动) */
  words: string[];
  /** 自动取词个数(3-4;固定词不足时也以此为补齐目标) */
  count: number;
}

export const DEFAULT_HOME_SEARCH_TERMS_CONFIG: HomeSearchTermsConfig = {
  words: [],
  count: DEFAULT_SEARCH_TERMS_COUNT,
};

/** 词表归一:trim、丢弃空/单字/超长、大小写不敏感去重(保留首次出现的拼写与顺序)、截 4 个 */
export function normalizeSearchTermsWords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const word = item.trim();
    if (word.length < 2 || word.length > SEARCH_TERM_WORD_MAX) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= SEARCH_TERMS_MAX_WORDS) break;
  }
  return out;
}

/** 个数归一:非整数/低于下限 → 默认 3;超上限 → clamp 4 */
export function clampSearchTermsCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < SEARCH_TERMS_MIN_COUNT) return DEFAULT_SEARCH_TERMS_COUNT;
  return Math.min(SEARCH_TERMS_MAX_COUNT, n);
}

/** 存储值(JSON 文本)解析:缺行/坏 JSON/类型不符一律回默认,永不上抛
 *  (kv 可被手改,首页渲染不能坏在这) */
export function parseHomeSearchTerms(raw: string | null): HomeSearchTermsConfig {
  if (raw === null) return DEFAULT_HOME_SEARCH_TERMS_CONFIG;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_HOME_SEARCH_TERMS_CONFIG;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_HOME_SEARCH_TERMS_CONFIG;
  }
  const obj = parsed as { words?: unknown; count?: unknown };
  return {
    words: normalizeSearchTermsWords(obj.words),
    count: clampSearchTermsCount(obj.count),
  };
}

/** 落库前归一(去重/截断/钳个数),保证 GET 回显与库内一致 */
export function serializeHomeSearchTerms(cfg: HomeSearchTermsConfig): string {
  return JSON.stringify({
    words: normalizeSearchTermsWords(cfg.words),
    count: clampSearchTermsCount(cfg.count),
  });
}

// ── 读侧 ──────────────────────────────────────────────────────

/** 单键读值(构建期无库/缺行 → null,由各键解析器回落)。
 * cache() 同请求去重:一次渲染 metadata+Header+Footer 等各键读取不再各自查库
 * (实测单渲染最多 4-5 次 siteConfig 查询,M48 批B) */
const readConfigValue = cache((key: string): Promise<string | null> => {
  return prerenderSafe(`site_config.${key}`, null, async () => {
    const row = await prisma.siteConfig.findUnique({ where: { key }, select: { value: true } });
    return row?.value ?? null;
  });
});

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

/** ICP 备案号(空/缺省 → 空串,页脚不渲染备案行) */
export async function getSiteIcp(): Promise<string> {
  return ((await readConfigValue(SITE_CONFIG_KEYS.icp)) ?? "").trim();
}

/** hub 主文案 markdown(空/缺省 → 空串,前台回退内置文案) */
export async function getHeroMd(): Promise<string> {
  return ((await readConfigValue(SITE_CONFIG_KEYS.heroMd)) ?? "").trim();
}

/**
 * 文章页版权声明(2026-11-01):缺行(从未配置)→ 内置默认;显式存空串 → 空,
 * 前台整块不渲染(「关掉」与「没配过」必须可区分,否则后台没法关闭该区块)。
 */
export async function getPostCopyrightMd(): Promise<string> {
  const raw = await readConfigValue(SITE_CONFIG_KEYS.postCopyrightMd);
  if (raw === null) return DEFAULT_POST_COPYRIGHT_MD;
  return raw.trim();
}

/** 全量设置(admin 页与 GET API 共用;单次 findMany,构建期 → 全默认) */
export interface SiteSettings {
  bandItemCount: number;
  repoCount: number;
  postCount: number;
  siteTitle: string;
  heroMd: string;
  aboutMd: string;
  icp: string;
  /** 文章页版权声明(从未配置时回显内置默认,便于站长在其上改) */
  postCopyrightMd: string;
  /** 首页搜索建议词(固定词 + 自动取词个数) */
  homeSearchTerms: HomeSearchTermsConfig;
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
      icp: "",
      postCopyrightMd: DEFAULT_POST_COPYRIGHT_MD,
      homeSearchTerms: DEFAULT_HOME_SEARCH_TERMS_CONFIG,
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
        icp: (byKey.get(SITE_CONFIG_KEYS.icp) ?? "").trim(),
        postCopyrightMd: byKey.has(SITE_CONFIG_KEYS.postCopyrightMd)
          ? (byKey.get(SITE_CONFIG_KEYS.postCopyrightMd) ?? "").trim()
          : DEFAULT_POST_COPYRIGHT_MD,
        homeSearchTerms: parseHomeSearchTerms(byKey.get(SITE_CONFIG_KEYS.homeSearchTerms) ?? null),
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
  icp: z.string().trim().max(ICP_MAX).optional(),
  /** 纯文本(可含换行);空串 = 关闭文章页版权声明块 */
  postCopyrightMd: z.string().trim().max(COPYRIGHT_MD_MAX).optional(),
  /** 首页搜索建议词:words 最多 4 个且各 ≤24 字;count 3-4(strict 防字段拼错被静默丢弃) */
  homeSearchTerms: z
    .object({
      words: z
        .array(z.string().trim().min(2).max(SEARCH_TERM_WORD_MAX))
        .max(SEARCH_TERMS_MAX_WORDS)
        .default([]),
      count: z
        .number()
        .int()
        .min(SEARCH_TERMS_MIN_COUNT)
        .max(SEARCH_TERMS_MAX_COUNT)
        .default(DEFAULT_SEARCH_TERMS_COUNT),
    })
    .strict()
    .optional(),
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
  if (data.icp !== undefined) {
    rows.push({ key: SITE_CONFIG_KEYS.icp, value: data.icp });
  }
  if (data.postCopyrightMd !== undefined) {
    rows.push({ key: SITE_CONFIG_KEYS.postCopyrightMd, value: data.postCopyrightMd });
  }
  if (data.homeSearchTerms !== undefined) {
    rows.push({
      key: SITE_CONFIG_KEYS.homeSearchTerms,
      value: serializeHomeSearchTerms(data.homeSearchTerms),
    });
  }
  if (rows.length === 0) return;
  await prisma.$transaction(
    rows.map((r) =>
      prisma.siteConfig.upsert({ where: { key: r.key }, update: { value: r.value }, create: r }),
    ),
  );
}
