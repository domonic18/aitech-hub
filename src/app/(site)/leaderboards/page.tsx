import type { Metadata } from "next";

import LeaderboardView from "@/components/site/LeaderboardView";
import { buildLeaderboardJsonLd, listPublicLeaderboards } from "@/lib/leaderboard/public";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * /leaderboards/ 模型榜单(M58 批③,data-expansion-plan §6.3):ISR 3600s,
 * 全量榜单 SSR 直出进 HTML(SEO 生命线——页面即数据);JSON-LD ItemList 同源
 * 构造。静态路由优先级高于 (site)/[slug] legacy catcher(同 /pricing/ 先例)。
 * 榜单切换走页内锚点而非 query:读 searchParams 会让整页转动态渲染,ISR 失效。
 */
export const revalidate = 3600;

const PAGE_PATH = "/leaderboards/";

export function generateMetadata(): Metadata {
  return {
    title: "AI 模型榜单",
    description:
      "AI 模型与社区热度多榜聚合:Artificial Analysis 智能指数、Hugging Face 趋势、arXiv 最新论文、GitHub 热门仓库,每日采集,名次变动与上一可用日期比较。",
    alternates: { canonical: PAGE_PATH },
  };
}

export default async function LeaderboardsPage(): Promise<React.ReactElement> {
  const data = await listPublicLeaderboards();
  const jsonLd = buildLeaderboardJsonLd(data, absoluteUrl(PAGE_PATH));
  return (
    <>
      {data.boards.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <LeaderboardView data={data} />
    </>
  );
}
