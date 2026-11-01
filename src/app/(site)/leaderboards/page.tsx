import type { Metadata } from "next";

import LeaderboardView from "@/components/site/LeaderboardView";
import { getUsdCnyRate } from "@/lib/leaderboard/fx";
import {
  buildLeaderboardJsonLd,
  latestCapturedDate,
  listPublicLeaderboards,
} from "@/lib/leaderboard/public";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * /leaderboards/ AI 榜单(M58 批③,data-expansion-plan §6.3;M63 可视化改版):
 * ISR 3600s,全量榜单 SSR 直出进 HTML(SEO 生命线——页面即数据);JSON-LD
 * ItemList 同源构造。静态路由优先级高于 (site)/[slug] legacy catcher(同 /pricing/ 先例)。
 * 三节并列(能力与价格 / HF 热门模型 / 热门仓库)走页内锚点而非 query:
 * 读 searchParams 会让整页转动态渲染,ISR 失效。论文榜前台移除,采集保留。
 */
export const revalidate = 3600;

const PAGE_PATH = "/leaderboards/";

export function generateMetadata(): Metadata {
  return {
    title: "AI 榜单",
    description:
      "AI 榜单聚合:模型能力与输出价格的分布、Hugging Face 热门模型(下载量 × 点赞数)、GitHub 热门仓库,每日采集,名次变动与上一可用日期比较。",
    alternates: { canonical: PAGE_PATH },
  };
}

export default async function LeaderboardsPage(): Promise<React.ReactElement> {
  // 汇率与榜单并行取;汇率缺行时回落默认值,不阻塞页面
  const [data, fx] = await Promise.all([listPublicLeaderboards(), getUsdCnyRate()]);
  // 论文榜前台移除(采集保留):JSON-LD 只列页面可见的三个榜,不喂隐藏内容
  const visibleBoards = data.boards.filter((b) => b.entityType !== "paper");
  const jsonLd = buildLeaderboardJsonLd(
    { boards: visibleBoards, asOf: latestCapturedDate(visibleBoards) },
    absoluteUrl(PAGE_PATH),
  );
  return (
    <>
      {visibleBoards.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <LeaderboardView data={data} fx={fx} />
    </>
  );
}
