/**
 * /pricing/ 公开读侧(M55 批D):仅 enabled 行(停用/待审不可见),ISR SSR
 * 全量进 HTML(SEO 生命线);45 天过期提醒(D5)按表取 max(dataAsOf) 判——
 * 数据按源整批核对,不做行级混合龄;JSON-LD 清单同源构造(中立目录:
 * ItemList+Product 携双价描述,不用 Offer——本站不卖 API,冒充卖方有作弊信号)。
 */
import { DAY_MS } from "@/lib/datetime";

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
  /** 模型模态(字典表);未归一为 null */
  modality: string | null;
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

/** 上下文长度解析:"128K"→131072 / "1M"→1048576 / "200000"→200000;认不出 null */
export function parseContextTokens(raw: string | null): number | null {
  if (raw === null) return null;
  const t = raw.trim().toUpperCase();
  if (t === "") return null;
  const m = /^([\d.]+)\s*([KM])?$/.exec(t);
  if (m === null) return null;
  const v = Number(m[1]);
  if (Number.isNaN(v)) return null;
  const unit = m[2] ?? "";
  if (unit === "K") return v * 1024;
  if (unit === "M") return v * 1024 * 1024;
  return v;
}

/** 上下文区间档(筛选用):按「至少多少」分档,未知单列 */
export const CONTEXT_BANDS = [
  { id: "all", label: "全部", min: null },
  { id: "ge1m", label: "≥ 1M", min: 1024 * 1024 },
  { id: "ge256k", label: "≥ 256K", min: 256 * 1024 },
  { id: "ge128k", label: "≥ 128K", min: 128 * 1024 },
  { id: "lt128k", label: "< 128K", min: null },
  { id: "unknown", label: "未标注", min: null },
] as const;

export type ContextBandId = (typeof CONTEXT_BANDS)[number]["id"];

/** 上下文档命中判定(未知档只收未标注的行;其它档按 token 数下界) */
export function inContextBand(tokens: number | null, id: ContextBandId): boolean {
  if (id === "all") return true;
  if (id === "unknown") return tokens === null;
  if (id === "lt128k") return tokens !== null && tokens < 128 * 1024;
  const band = CONTEXT_BANDS.find((b) => b.id === id);
  if (band === undefined || band.min === null) return true;
  return tokens !== null && tokens >= band.min;
}

/** 模态筛选项(字典表的 modality 值;空 = 未标注) */
export const MODALITY_OPTIONS = [
  { id: "", label: "全部" },
  { id: "text", label: "文本" },
  { id: "text+vision", label: "图文" },
  { id: "image", label: "图像" },
  { id: "audio", label: "音频" },
  { id: "video", label: "视频" },
  { id: "embedding", label: "向量" },
  { id: "rerank", label: "重排" },
] as const;

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
  freeOnly: boolean;
  modality: string;
  contextBand: ContextBandId;
  sourceKind: string;
}

/**
 * 模型行筛选(厂商 × 价格区间 × 免费 × 模态 × 上下文 × 来源类型)。
 * null 价不进具体价格区间档(不臆测);免费只看 is_free 标记(完全免费),
 * 「有免费额度」是另一回事(free_tier 原文),不在此过滤。
 */
export function filterModelRows(
  rows: PublicModelRow[],
  opts: ModelFilterOptions,
): PublicModelRow[] {
  return rows.filter((r) => {
    if (opts.vendors.length > 0 && !opts.vendors.includes(r.vendor)) return false;
    if (!inPriceBand(r.inputPrice, opts.band)) return false;
    if (opts.freeOnly && !r.isFree) return false;
    if (opts.modality !== "" && (r.modality ?? "") !== opts.modality) return false;
    if (!inContextBand(parseContextTokens(r.contextWindow), opts.contextBand)) return false;
    if (opts.sourceKind !== "" && (r.providerKind ?? "") !== opts.sourceKind) return false;
    return true;
  });
}

/**
 * 模型行排序:默认与「输入价」同序(按价升序——这页是来找便宜的),
 * null 价恒排最后(未公布价不是「最便宜」),同价按模型名定序,保证结果稳定。
 */
export function sortModelRows(rows: PublicModelRow[], sort: ModelSortId): PublicModelRow[] {
  const priceOf = (r: PublicModelRow): number | null =>
    sort === "output" ? r.outputPrice : r.inputPrice;
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
 * 币符与数值间空格(Ardot P1 定稿版式) */
export function formatPrice(price: number | null, currency: string): string {
  if (price === null) return "未公布";
  return `${currency === "USD" ? "$" : "¥"} ${price}`;
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

/** JSON-LD 清单(纯函数,单测锚):ItemList+Product 携双价描述;无价格页退化为
 * 空清单(页骨架仍 SSR,SEO 面不空)。截稿日期入 description 溯源。 */
export function buildPricingJsonLd(data: PublicPricing, pageUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "AI 模型牌价速查",
    url: pageUrl,
    numberOfItems: data.models.length + data.plans.length,
    itemListElement: [
      ...data.models.map((m, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name: `${m.vendor} ${m.modelKey}`,
          description: `输入 ${formatPrice(m.inputPrice, m.currency)} / 输出 ${formatPrice(
            m.outputPrice,
            m.currency,
          )}(每百万 tokens,${m.currency} 原币),数据截至 ${m.dataAsOf}`,
          url: pageUrl,
        },
      })),
      ...data.plans.map((p, i) => ({
        "@type": "ListItem",
        position: data.models.length + i + 1,
        item: {
          "@type": "Product",
          name: `${p.vendor} ${p.planName}`,
          description: `月费 ${formatPrice(p.monthlyFee, p.currency)},额度:${p.quotaDesc},数据截至 ${p.dataAsOf}`,
          url: pageUrl,
        },
      })),
    ],
  };
}
