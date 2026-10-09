/**
 * 站点统计页(M5-c;原型 admin-stats):KPI 四卡 / PV·UV 趋势(手写 SVG)/
 * 流量来源 / 访客环境 / 热门页面,整页服务端渲染直调读侧 queries。
 * 分段切换全 URL 驱动:trend=7|30|90、hot=today|7d|30d|all(非法值回落默认)。
 * 口径:站点级统计自新站上线起算(WP 明细不迁移);「今日」读日聚合表,
 * 经 60s worker flush,最长延迟约 2 分钟。M10 批⑥:尾部加最近访问明细
 * (行级,近 7 天,全量 IP 短留存)。
 */
import BotPanel from "@/components/admin/stats/BotPanel";
import EnvPanel from "@/components/admin/stats/EnvPanel";
import GeoPanel from "@/components/admin/stats/GeoPanel";
import HotPagesTable from "@/components/admin/stats/HotPagesTable";
import HotSearchTermsTable from "@/components/admin/stats/HotSearchTermsTable";
import KpiCards from "@/components/admin/stats/KpiCards";
import RecentVisitsTable from "@/components/admin/stats/RecentVisitsTable";
import SourcePanel from "@/components/admin/stats/SourcePanel";
import TrendChart from "@/components/admin/stats/TrendChart";
import {
  getBotPanel,
  getClientPanel,
  getGeoPanel,
  getHotPages,
  getHotSearchTerms,
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

  const [overview, series, referrers, clients, bots, geo, hotPages, hotTerms, recentVisits] =
    await Promise.all([
      getVisitOverview(),
      getVisitSeries(trend),
      getReferrerPanel(7),
      getClientPanel(7),
      getBotPanel(7),
      getGeoPanel(7),
      getHotPages(hot),
      getHotSearchTerms(hot),
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
      {/* 爬虫流量(2026-10-07 方案B):人机区分的「机」侧;与真人四分类同表分账 */}
      <BotPanel panel={bots} humanPv={overview.last7.pv} />
      {/* GEO 机器面(2026-10-09 方案A):llms/.md 机器消费观测,stats_geo_daily */}
      <GeoPanel panel={geo} />
      <HotPagesTable rows={hotPages} range={hot} trend={trend} />
      {/* 搜索词排行(2026-10-06):与热门页面共用 hot 分段;行级直插准实时 */}
      <HotSearchTermsTable rows={hotTerms} range={hot} trend={trend} />
      <RecentVisitsTable rows={recentVisits} />
    </div>
  );
}
