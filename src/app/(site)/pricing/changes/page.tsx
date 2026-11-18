import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/site/PageHeader";
import { PriceChangeList } from "@/components/site/pricing/PriceChangeList";
import { listPublicPriceChanges } from "@/lib/pricing/changes-read";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * /pricing/changes/ 降价史(M74 批F):采集口径下的模型降价记录。
 *
 * ISR 600s(与 /pricing/ 同节拍);独立路由而非 /pricing/ 的页签——
 * 页签内容只在客户端切过去才渲染,爬虫看不见;独立路由既可被抓,又
 * 完全不碰 /pricing/ 首屏 HTML(SSR 红线:首屏必须含未筛选全量行)。
 */
export const revalidate = 600;

const PAGE_PATH = "/pricing/changes/";

export function generateMetadata(): Metadata {
  return {
    title: "AI 模型降价记录",
    description:
      "主流大模型按量牌价的降价记录:采集官方牌价页逐日比对,记录输入价/生成价的下调,原币直出。",
    alternates: { canonical: PAGE_PATH },
  };
}

export default async function PricingChangesPage(): Promise<React.ReactElement> {
  const changes = await listPublicPriceChanges();
  // 变更史 JSON-LD(ItemList):让搜索引擎看到「哪些模型降过价、降到多少」
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "AI 模型降价记录",
    url: absoluteUrl(PAGE_PATH),
    numberOfItems: changes.items.length,
    itemListElement: changes.items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Product",
        name: `${c.providerName} ${c.modelKey}`,
        description: `${c.oldInputPrice ?? c.oldOutputPrice ?? "—"} → ${c.newInputPrice ?? c.newOutputPrice ?? "—"}(${c.currency}),降价于 ${c.changedAt}`,
        url: absoluteUrl(PAGE_PATH),
      },
    })),
  };
  return (
    <>
      {changes.items.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <PageHeader
        eyebrow="TOOL HOOK · 工具钩子 01"
        title="AI 模型降价记录"
        description="按官方牌价页逐日采集比对,记录模型的输入价/生成价下调(近 90 天,采集口径;原币直出不折算)。价格变动以官方页面为准,本站不卖 API。"
      >
        <div className="mt-5 overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
          <div className="flex items-center gap-2 border-b border-line bg-panel-2/50 px-4 py-3">
            <h2 className="text-[13px] font-semibold text-text-1">最近降价</h2>
            <span className="ml-auto font-mono text-[11px] text-blue">{changes.total}</span>
          </div>
          <PriceChangeList items={changes.items} total={changes.total} />
        </div>
        <p className="mt-4 text-[11.5px] text-text-3">
          想横向比价(同模型跨提供商谁最便宜),回
          <Link href="/pricing/" className="mx-1 text-blue hover:text-blue/80">
            模型牌价速查
          </Link>
          切「比价」视图。
        </p>
        <p className="mt-1 text-[11px] text-text-3/80">
          变更史自 M74 上线后开始累计;后台人工调价不在本表口径内。
        </p>
      </PageHeader>
    </>
  );
}
