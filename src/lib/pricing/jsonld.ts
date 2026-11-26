/**
 * /pricing/ 的 JSON-LD 构造(M74 批D7):中立目录 ItemList + Product。
 *
 * 纯函数、零库依赖(与 public.ts 同纪律)——单独成模块是为了不把已近 400 行的
 * public.ts 再撑大。
 *
 * 三条口径:
 * - **不用 Offer**:本站不卖 API,结构化数据里冒充卖方有作弊信号。价格只进
 *   `description` 与 `additionalProperty`(PropertyValue),机器可读但不声明交易。
 * - **url 用真锚点**:页内没有每模型独立路由,故 url 指向页内锚点
 *   (`#p-…`),锚点 id 由 `modelAnchorId` 生成并**真的渲染在行上**——
 *   指向不存在的锚点等于骗爬虫。
 * - **比价并进同一条目**:比价视图是纯客户端,爬虫看不到;把「同模型报价家数」
 *   「最低价提供商」作为条目属性输出,核心卖点才进机器可读层(多 script 只有
 *   第一个被解析,所以不另开 ld+json)。
 */
import { formatPrice, type PublicPricing } from "./public";
import { protocolsLabel } from "./protocols";
import type { LeaderboardBadge } from "./leaderboard-ref";

/** 模态 → 用途标签(JSON-LD category 用) */
export function modalityLabel(modality: string | null): string {
  switch ((modality ?? "").trim()) {
    case "text":
      return "文本模型";
    case "text+vision":
      return "多模态模型";
    case "image":
      return "文生图模型";
    case "video":
      return "文生视频模型";
    case "audio":
      return "音频模型";
    case "embedding":
      return "向量模型";
    case "rerank":
      return "重排模型";
    default:
      return "AI 模型";
  }
}

/**
 * 页内锚点 id:厂商+模型 → 稳定唯一锚。
 * 用 percent-encoding 兜住中文与斜杠(`~` 不会被 encodeURIComponent 编码,
 * 故可安全作分隔符,原串里不可能出现)。
 */
export function modelAnchorId(vendor: string, modelKey: string): string {
  const enc = (s: string): string => encodeURIComponent(s).replace(/%/g, "~");
  return `p-${enc(vendor)}-${enc(modelKey)}`;
}

/** 比价摘要(页面层从 compare.ts 装配后传入,避免本模块与 compare.ts 循环依赖) */
export interface PricingCompareEntry {
  /** 归一键(modelDictKey ?? modelKey) */
  key: string;
  displayName: string;
  /** 同模型同币种同单位下的报价家数 */
  providerCount: number;
  cheapestProvider: string | null;
  cheapestPrice: number | null;
  currency: string;
}

/** 价格口径文案:token 系沿「每百万 tokens」;非 token 行按单位 */
function priceUnitDesc(unit: string): string {
  switch (unit) {
    case "per_image":
      return "元/张";
    case "per_second":
      return "元/秒";
    case "per_minute":
      return "元/分钟";
    case "per_1k_tokens":
      return "每千 tokens";
    default:
      return "每百万 tokens";
  }
}

/** 结构化数据里的价格属性(不用 Offer,只作 PropertyValue) */
function priceProperty(
  name: string,
  price: number | null,
  currency: string,
  unit: string,
): Record<string, unknown> {
  return {
    "@type": "PropertyValue",
    name,
    value: formatPrice(price, currency, unit),
    unitText: priceUnitDesc(unit),
  };
}

/**
 * JSON-LD 清单:ItemList + Product 携双价描述与结构化属性。
 * 无价格页退化为空清单(页骨架仍 SSR,SEO 面不空)。
 */
export function buildPricingJsonLd(
  data: PublicPricing,
  pageUrl: string,
  opts?: {
    compare?: PricingCompareEntry[];
    leaderboard?: Map<string, LeaderboardBadge[]>;
  },
): Record<string, unknown> {
  const compareMap = new Map((opts?.compare ?? []).map((c) => [c.key, c]));
  const leaderboardMap = opts?.leaderboard ?? new Map<string, LeaderboardBadge[]>();
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "AI 模型牌价速查",
    url: pageUrl,
    numberOfItems: data.models.length + data.plans.length,
    itemListElement: [
      ...data.models.map((m, i) => {
        const key = m.modelDictKey ?? m.modelKey;
        const cmp = compareMap.get(key);
        const props: Record<string, unknown>[] = [
          priceProperty("输入价", m.inputPrice, m.currency, m.priceUnit),
          priceProperty("输出价", m.outputPrice, m.currency, m.priceUnit),
          {
            "@type": "PropertyValue",
            name: "计价单位",
            value: priceUnitDesc(m.priceUnit),
          },
        ];
        if (m.contextWindow !== null) {
          props.push({ "@type": "PropertyValue", name: "上下文窗口", value: m.contextWindow });
        }
        if (m.protocols.length > 0) {
          props.push({
            "@type": "PropertyValue",
            name: "支持协议",
            value: protocolsLabel(m.protocols),
          });
        }
        if (cmp !== undefined) {
          props.push({
            "@type": "PropertyValue",
            name: "同模型报价家数",
            value: `${cmp.providerCount} 家`,
          });
          if (cmp.cheapestProvider !== null) {
            props.push({
              "@type": "PropertyValue",
              name: "最低价提供商",
              value: `${cmp.cheapestProvider}(${formatPrice(cmp.cheapestPrice, cmp.currency)})`,
            });
          }
        }
        const badges = leaderboardMap.get(key);
        if (badges !== undefined && badges.length > 0) {
          for (const b of badges) {
            props.push({
              "@type": "PropertyValue",
              name: `${b.source} 榜单排名`,
              value: `第 ${b.rank} 名`,
            });
          }
        }
        return {
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "Product",
            name: `${m.vendor} ${m.modelKey}`,
            description: `输入 ${formatPrice(m.inputPrice, m.currency)} / 输出 ${formatPrice(
              m.outputPrice,
              m.currency,
            )}(${priceUnitDesc(m.priceUnit)},${m.currency} 原币),数据截至 ${m.dataAsOf}`,
            url: `${pageUrl}#${modelAnchorId(m.vendor, m.modelKey)}`,
            identifier: `pricing:${m.vendor}|${m.modelKey}`,
            sku: `pricing:${m.vendor}|${m.modelKey}`,
            brand: { "@type": "Brand", name: m.providerName ?? m.vendor },
            category: `AI 模型 · ${modalityLabel(m.modality)}`,
            additionalProperty: props,
          },
        };
      }),
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
