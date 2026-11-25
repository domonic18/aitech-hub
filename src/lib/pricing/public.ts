/**
 * /pricing/ 公开读侧(M55 批D):仅 enabled 行(停用/待审不可见),ISR SSR
 * 全量进 HTML(SEO 生命线);45 天过期提醒(D5)按表取 max(dataAsOf) 判——
 * 数据按源整批核对,不做行级混合龄;JSON-LD 清单构造在 `./jsonld`(中立目录:
 * ItemList+Product 携双价描述,不用 Offer——本站不卖 API,冒充卖方有作弊信号)。
 */
import { DAY_MS } from "@/lib/datetime";

import { inContextBand, parseContextTokens, type ContextBandId } from "./context";
import type { ApiProtocol } from "./protocols";

/** ⚠️ 本模块必须保持**零库依赖**(无 db / prerender-safe / env):客户端组件
 *  (PricingExplorer 一族)直接引这里的纯函数与类型,读库那半边住 `./read.ts`。
 *  两者曾同居,导致 env 校验被打进 /pricing/ 的 client chunk、浏览器白屏
 *  (2026-11-01 生产事故,见 read.ts 头注)。 */

/** 过期提醒阈值(D5):数据 >45 天未核对出琥珀提醒条 */
export const PRICING_STALE_DAYS = 45;
/** 整表过期判定(纯函数,单测锚):max(dataAsOf) 距 now 超 45 天;空表不出提醒 */
export function isPricingStale(maxDataAsOf: Date | null, now: Date): boolean {
  if (maxDataAsOf === null) return false;
  return now.getTime() - maxDataAsOf.getTime() > PRICING_STALE_DAYS * DAY_MS;
}

export interface PublicModelRow {
  vendor: string;
  modelKey: string;
  currency: string;
  inputPrice: number | null;
  outputPrice: number | null;
  freeTier: string | null;
  /** 完全免费(M74):所有档位价均为 0;与 freeTier「有免费额度」语义分离 */
  isFree: boolean;
  contextWindow: string | null;
  note: string | null;
  dataAsOf: string; // YYYY-MM-DD(北京时区口径由写入侧保证)
  sourceUrl: string;
  region: string;
  /** 厂商规范键(M74 归一层);未归一的行(过渡期)为 null */
  providerKey: string | null;
  /** 厂商展示名(字典表);未归一时回落到 vendor */
  providerName: string | null;
  /** 厂商来源类型(字典表 source_kind):official 一手厂商 | aggregator 聚合平台挂牌价 */
  providerKind: string | null;
  /** 模型字典键(M74 跨厂商归一);未归一为 null */
  modelDictKey: string | null;
  /** 能力归一键(P1,`base::task`):同型号跨渠道(官方/聚合)比价聚合优先用它;
   *  未算出/冲突待裁为 null,回落 modelDictKey */
  modelGroupKey: string | null;
  /** 模型字典展示名(P1 透出;null 回落 modelDictKey) */
  modelDisplayName: string | null;
  /** 模型产品线(字典表 family;null=未推导) */
  modelFamily: string | null;
  /** 模型模态(字典表);未归一为 null */
  modality: string | null;
  /** 行级计价单位(批G):per_1m_tokens | per_image | per_second | …;
   *  非 token 行 outputPrice=生成价、inputPrice 多为 null */
  priceUnit: string;
  /** 支持的 API 协议(策展规则;空数组=未标注,不是「不支持」) */
  protocols: ApiProtocol[];
  /** 价格档位(阶梯/缓存/峰谷/模态计价);无档位则空数组 */
  tiers: PublicTierRow[];
}

/** 档位公开形状(阶梯价/缓存价/峰谷价;每百万 tokens 或其它计价单位) */
export interface PublicTierRow {
  tierLabel: string;
  inputPrice: number | null;
  outputPrice: number | null;
  cachePrice: number | null;
  minTokens: number | null;
  maxTokens: number | null;
  unit: string;
  currency: string;
}

// ---------- M74 批C:筛选维度与排序(纯函数,单测锚) ----------
// 批G:模态细筛升级为「用途分组」页签(cat),MODALITY_OPTIONS 退役

/** 用途分组(批G):模态 → 用户视角的用途大组;all = 不过滤 */
export type ModelCatId = "text" | "image" | "video" | "audio" | "vector" | "all";

export const MODEL_CAT_OPTIONS: ReadonlyArray<{
  id: ModelCatId;
  label: string;
  /** 命中的模态值;null = 不过滤(all) */
  modalities: readonly string[] | null;
}> = [
  { id: "text", label: "文本", modalities: ["text", "text+vision"] },
  { id: "image", label: "文生图", modalities: ["image"] },
  { id: "video", label: "文生视频", modalities: ["video"] },
  { id: "audio", label: "音频", modalities: ["audio"] },
  { id: "vector", label: "向量·重排", modalities: ["embedding", "rerank"] },
  { id: "all", label: "全部", modalities: null },
];

/** 用途分组 → 模态集合(null = 全部);未归一行的模态按 text 处理 */
export function catToModalities(cat: ModelCatId): readonly string[] | null {
  return MODEL_CAT_OPTIONS.find((c) => c.id === cat)?.modalities ?? null;
}

/** 行的生效模态(未归一/空按 text——现网存量行主体是文本模型) */
export function effectiveModality(row: Pick<PublicModelRow, "modality">): string {
  const m = (row.modality ?? "").trim();
  return m === "" ? "text" : m;
}

/** token 系计价单位(双价语义);其余为单价格(生成价)语义 */
export function isTokenPriced(row: Pick<PublicModelRow, "priceUnit">): boolean {
  return row.priceUnit === "per_1m_tokens" || row.priceUnit === "per_1k_tokens";
}

/**
 * 代表价(批G):排序/区间/比价/条形图共用的「这行多少钱」——
 * token 行=输入价(与既有口径一致),非 token 行=生成价(outputPrice)。
 */
export function representativePrice(
  row: Pick<PublicModelRow, "priceUnit" | "inputPrice" | "outputPrice">,
): number | null {
  return isTokenPriced(row) ? row.inputPrice : row.outputPrice;
}

/** 非计价单位的中文后缀(价格格展示;token 系为空——列头已注明百万 tokens) */
export const UNIT_SUFFIXES: Record<string, string> = {
  per_image: "/张",
  per_second: "/秒",
  per_minute: "/分钟",
};

/** 来源类型筛选项(厂商字典的 source_kind;空 = 未标注) */
export const SOURCE_KIND_OPTIONS = [
  { id: "", label: "全部" },
  { id: "official", label: "官方一手价" },
  { id: "aggregator", label: "聚合平台挂牌价" },
] as const;

/** 模型行排序方式 */
export type ModelSortId = "default" | "input" | "output" | "name";

export const MODEL_SORT_OPTIONS: ReadonlyArray<{ id: ModelSortId; label: string }> = [
  // 默认即「输入价低→高」:这页的诉求就是找便宜的,默认按库序(updatedAt)
  // 排出来对用户是乱的——最便宜的模型不在最前面等于没做
  { id: "default", label: "默认(输入价低→高)" },
  { id: "input", label: "输入价低→高" },
  { id: "output", label: "输出价低→高" },
  { id: "name", label: "模型名" },
];

/** 模型行筛选选项 */
export interface ModelFilterOptions {
  vendors: string[];
  band: PriceBandId;
  /** 免费口径(单选四态;两种免费语义分开,组合另设一档) */
  freeScope: FreeScopeId;
  /** 用途分组(批G;all = 不过滤模态) */
  cat: ModelCatId;
  contextBand: ContextBandId;
  sourceKind: string;
}

/**
 * 免费口径(单选四态):站内有两种**不同**的免费语义,混成一个开关就筛不出来
 * 「有免费额度但要按量付费」的那批行(测试库:完全免费 1 行 vs 有额度 72 行)。
 * - `all` 全部(不过滤)
 * - `full` 完全免费(`is_free`:调用不花钱,行级绿角标)
 * - `quota` 有免费额度(`free_tier` 原文非空:如「每日 200 万 tokens 免费」,
 *   调用要付费但有额度)
 * - `any` 任一免费(两者并集——「能白用的模型都在这」)
 */
export type FreeScopeId = "all" | "full" | "quota" | "any";

export const FREE_SCOPE_OPTIONS: ReadonlyArray<{ id: FreeScopeId; label: string }> = [
  { id: "all", label: "全部" },
  { id: "full", label: "完全免费" },
  { id: "quota", label: "有免费额度" },
  { id: "any", label: "任一免费" },
];

/** 免费口径命中判定(纯函数,单测锚) */
export function matchesFreeScope(
  row: Pick<PublicModelRow, "isFree" | "freeTier">,
  scope: FreeScopeId,
): boolean {
  const hasQuota = row.freeTier !== null && row.freeTier.trim() !== "";
  switch (scope) {
    case "full":
      return row.isFree;
    case "quota":
      return hasQuota;
    case "any":
      return row.isFree || hasQuota;
    default:
      return true;
  }
}

/**
 * 模型行筛选(厂商 × 价格区间 × 免费口径 × 用途分组 × 上下文 × 来源类型)。
 * 价格区间按**代表价**(token 行输入价 / 非行生成价)判——排序同口径;
 * null 价不进具体价格区间档(不臆测);免费口径按 `matchesFreeScope` 判
 * (「有免费额度」与「完全免费」是两种语义,分开);
 * 「有免费额度」原文非空才算有额度(空串视同无)。
 */
export function filterModelRows(
  rows: PublicModelRow[],
  opts: ModelFilterOptions,
): PublicModelRow[] {
  const catMods = catToModalities(opts.cat);
  return rows.filter((r) => {
    if (opts.vendors.length > 0 && !opts.vendors.includes(r.vendor)) return false;
    if (!inPriceBand(representativePrice(r), opts.band)) return false;
    if (!matchesFreeScope(r, opts.freeScope)) return false;
    if (catMods !== null && !catMods.includes(effectiveModality(r))) return false;
    if (!inContextBand(parseContextTokens(r.contextWindow), opts.contextBand)) return false;
    if (opts.sourceKind !== "" && (r.providerKind ?? "") !== opts.sourceKind) return false;
    return true;
  });
}

/**
 * 模型行排序:默认与「价格低→高」同序(**代表价**:token 行输入价、
 * 非 token 行生成价——这页是来找便宜的),null 价恒排最后
 * (未公布价不是「最便宜」),同价按模型名定序,保证结果稳定。
 */
export function sortModelRows(rows: PublicModelRow[], sort: ModelSortId): PublicModelRow[] {
  const priceOf = (r: PublicModelRow): number | null =>
    sort === "output" ? r.outputPrice : representativePrice(r);
  return [...rows].sort((a, b) => {
    const pa = priceOf(a);
    const pb = priceOf(b);
    if (pa === null && pb === null) return a.modelKey.localeCompare(b.modelKey);
    if (pa === null) return 1;
    if (pb === null) return -1;
    if (pa !== pb) return pa - pb;
    return a.modelKey.localeCompare(b.modelKey);
  });
}

export interface PublicPlanRow {
  vendor: string;
  planName: string;
  currency: string;
  monthlyFee: number | null;
  quarterlyFee: number | null;
  yearlyFee: number | null;
  billingNote: string | null;
  benefits: string[] | null;
  quotaDesc: string;
  peakRate: string | null;
  offPeakRate: string | null;
  bestFor: string | null;
  note: string | null;
  dataAsOf: string;
  sourceUrl: string;
}

export interface PublicPricing {
  models: PublicModelRow[];
  plans: PublicPlanRow[];
  /** 整表 max(dataAsOf)(YYYY-MM-DD),驱动截稿横幅与 45 天提醒;空表 null */
  modelsAsOf: string | null;
  plansAsOf: string | null;
}

/** 价格格(纯函数,单测锚):null=未公布(禁臆测);USD 原币直出不折算(D4);
 * 币符与数值间空格(Ardot P1 定稿版式);非 token 计价单位带中文后缀(批G) */
export function formatPrice(price: number | null, currency: string, unit?: string): string {
  if (price === null) return "未公布";
  const suffix = unit === undefined ? "" : (UNIT_SUFFIXES[unit] ?? "");
  return `${currency === "USD" ? "$" : "¥"} ${price}${suffix}`;
}

/** 计价单位的展示口径(列头/图注用):token 系为空串(由列头统一注明) */
export function unitLabel(unit: string): string {
  return UNIT_SUFFIXES[unit] ?? "";
}

/** 模型分组排序(P2-15 纯函数,单测锚;自 PricingView 下沉):国内¥ → 国际$ →
 * 其余混合组(组间按 region|currency 字典序,展示侧 groupKey 键格式须与此一致);
 * 稳定排序——同组内保持入参原序(行序由取数侧 orderBy 决定,排序不改写)。 */
export function sortPublicModels(models: PublicModelRow[]): PublicModelRow[] {
  const key = (r: PublicModelRow): string => `${r.region}|${r.currency}`;
  const rank = (k: string): number => (k === "cn|CNY" ? 0 : k === "intl|USD" ? 1 : 2);
  return [...models].sort((a, b) => rank(key(a)) - rank(key(b)) || key(a).localeCompare(key(b)));
}

// ---------- 展示侧筛选(M55 批E 验收问题一:内容多 → 厂商/价格区间) ----------

/** 价格区间档(左闭右开):套餐按**月费**,模型按**输入价 / 百万 tokens**
 * (行内币种,不做汇率折算——D4 原币直出的延伸)。价格未公布(null)只出现在
 * 「全部」档:归入任何具体区间都是臆测。 */
export const PRICE_BANDS = [
  { id: "all", label: "全部", min: 0, max: Number.POSITIVE_INFINITY },
  { id: "lt10", label: "≤ 10", min: 0, max: 10 },
  { id: "10-50", label: "10 – 50", min: 10, max: 50 },
  { id: "50-100", label: "50 – 100", min: 50, max: 100 },
  { id: "100-300", label: "100 – 300", min: 100, max: 300 },
  { id: "gte300", label: "300 以上", min: 300, max: Number.POSITIVE_INFINITY },
] as const;

export type PriceBandId = (typeof PRICE_BANDS)[number]["id"];

export function inPriceBand(price: number | null, id: PriceBandId): boolean {
  if (id === "all") return true;
  if (price === null) return false;
  const band = PRICE_BANDS.find((b) => b.id === id);
  if (band === undefined) return true;
  return price >= band.min && price < band.max;
}

/** 厂商选项(去重 + 字典序,中英文混排按 localeCompare) */
export function vendorOptions<T>(rows: T[], vendorOf: (r: T) => string): string[] {
  return [...new Set(rows.map(vendorOf))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

/** 厂商(空=全选)× 价格区间 联合筛选;纯函数,单测锚 */
export function filterPricingRows<T>(
  rows: T[],
  opts: {
    vendors: string[];
    band: PriceBandId;
    vendorOf: (r: T) => string;
    priceOf: (r: T) => number | null;
  },
): T[] {
  return rows.filter(
    (r) =>
      (opts.vendors.length === 0 || opts.vendors.includes(opts.vendorOf(r))) &&
      inPriceBand(opts.priceOf(r), opts.band),
  );
}

/** JSON-LD 清单构造已迁至 `./jsonld`(批D7:补 brand/identifier/比价摘要,
 *  避免本文件继续膨胀;公开面仍只有一处出口) */
