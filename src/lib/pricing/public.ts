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
  contextWindow: string | null;
  note: string | null;
  dataAsOf: string; // YYYY-MM-DD(北京时区口径由写入侧保证)
  sourceUrl: string;
  region: string;
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
