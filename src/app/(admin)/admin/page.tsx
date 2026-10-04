/**
 * 站点统计页(M5-c;原型 admin-stats):KPI 四卡 / PV·UV 趋势(手写 SVG)/
 * 流量来源 / 访客环境 / 热门页面,整页服务端渲染直调读侧 queries。
 * 分段切换全 URL 驱动:trend=7|30|90、hot=today|7d|30d|all(非法值回落默认)。
 * 口径:站点级统计自新站上线起算(WP 明细不迁移);「今日」读日聚合表,
 * 经 60s worker flush,最长延迟约 2 分钟。M10 批⑥:尾部加最近访问明细
 * (行级,近 7 天,全量 IP 短留存)。
 */
import EnvPanel from "@/components/admin/stats/EnvPanel";
import HotPagesTable from "@/components/admin/stats/HotPagesTable";
import KpiCards from "@/components/admin/stats/KpiCards";
import RecentVisitsTable from "@/components/admin/stats/RecentVisitsTable";
import SourcePanel from "@/components/admin/stats/SourcePanel";
import TrendChart from "@/components/admin/stats/TrendChart";
import {
  getClientPanel,
  getHotPages,
  getRecentVisits,
  getReferrerPanel,
  getVisitOverview,
  getVisitSeries,
  type HotRange,
} from "@/lib/stats/queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ trend?: string; hot?: string }>;
}

function parseTrend(raw: string | undefined): 7 | 30 | 90 {
  if (raw === "30") return 30;
  if (raw === "90") return 90;
  return 7;
}

function parseHot(raw: string | undefined): HotRange {
  return raw === "7d" || raw === "30d" || raw === "all" ? raw : "today";
}

export default async function AdminStatsPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const sp = await searchParams;
  const trend = parseTrend(sp.trend);
  const hot = parseHot(sp.hot);

  const [overview, series, referrers, clients, hotPages, recentVisits] = await Promise.all([
    getVisitOverview(),
    getVisitSeries(trend),
    getReferrerPanel(7),
    getClientPanel(7),
    getHotPages(hot),
    getRecentVisits(30),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <KpiCards overview={overview} />
      <TrendChart series={series} trend={trend} hot={hot} />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <SourcePanel panel={referrers} />
        <EnvPanel panel={clients} />
      </div>
      <HotPagesTable rows={hotPages} range={hot} trend={trend} />
      <RecentVisitsTable rows={recentVisits} />
    </div>
  );
}
