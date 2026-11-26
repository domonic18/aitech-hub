import type { Metadata } from "next";

import PricingExplorer from "@/components/site/pricing/PricingExplorer";
import { absoluteUrl } from "@/lib/seo/site";
import { buildCompareGroups } from "@/lib/pricing/compare";
import { listPublicPriceChanges } from "@/lib/pricing/changes-read";
import { buildPricingJsonLd, type PricingCompareEntry } from "@/lib/pricing/jsonld";
import { loadPricingLeaderboardPresence } from "@/lib/pricing/leaderboard-ref";
import { listPublicPricing } from "@/lib/pricing/read";

/**
 * /pricing/ 模型牌价速查(M55 批D,D1 slug 避开 admin/models 语义撞;Ardot P1
 * 桌面定稿):ISR 600s,双表 SSR 全量 enabled 行进 HTML(SEO 生命线——页面
 * 即数据);JSON-LD ItemList 同源构造;静态路由优先级高于 (site)/[slug]
 * legacy catcher(同 /projects 先例)。爬虫/手工初稿在策展台人工终审后才可见。
 */
export const revalidate = 600;

const PAGE_PATH = "/pricing/";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "AI 模型价格速查",
    description:
      "主流大模型官方牌价一觉:输入/输出价、免费额度与上下文窗口,Coding Plan 订阅套餐额度口径。官方一手价人工核对,USD 原币直出,每月更新。",
    alternates: { canonical: PAGE_PATH },
  };
}

export default async function PricingPage(): Promise<React.ReactElement> {
  const [data, changes] = await Promise.all([listPublicPricing(), listPublicPriceChanges()]);
  const leaderboardMap = await loadPricingLeaderboardPresence(data.models);
  // 比价摘要在服务端装配(比价视图是纯客户端,爬虫看不到;把「谁最便宜」
  // 作为条目属性进机器可读层——批D7)。cheapestProvider 取显示名。
  const compareEntries: PricingCompareEntry[] = buildCompareGroups(data.models).flatMap((g) =>
    g.models.map((m) => {
      const cheapest = m.cells.find((c) => c.providerKey === m.cheapestProviderKey) ?? null;
      return {
        key: m.key,
        displayName: m.displayName,
        providerCount: m.providerCount,
        cheapestProvider: cheapest?.providerName ?? null,
        cheapestPrice:
          cheapest === null ? null : (cheapest.inputPrice ?? cheapest.outputPrice ?? null),
        currency: g.currency,
      };
    }),
  );
  const jsonLd = buildPricingJsonLd(data, absoluteUrl(PAGE_PATH), {
    compare: compareEntries,
    leaderboard: leaderboardMap,
  });
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* 不包 Suspense:包了会让静态预渲染时整块内容退化成 fallback(SSR 变空壳),
          页必须输出**未筛选的全量**(SEO 生命线);筛选态由客户端按 URL 覆盖 */}
      <PricingExplorer data={data} changeCount={changes.total} leaderboardMap={leaderboardMap} />
    </>
  );
}
