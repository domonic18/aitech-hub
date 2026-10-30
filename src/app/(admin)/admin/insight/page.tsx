/**
 * 洞察中心·分析总览(F11 板,v2 对齐设计稿):pageHead(窗口 chips + 立即
 * 分析)→ heroRow(关键词云图(舆情四色+图例筛选) + KPI 四竖列 + 日批
 * status)→ row2(机会分趋势 + 痛点榜)→ row3(热榜信号(渠道页签可切,合并
 * 全宽榜)+ 种子词产出榜)→ 最新信号预览卡(M59 批A:最近 5 条 + 全量入口)。
 * 取数页侧一次装配;窗口 chips 钳统计窗口(w)并附窗口统计徽章(窗口只影响
 * 词云,KPI 板定固定口径,徽章让取景范围可见);热榜回看日(day)页签随卡头
 * 常驻(板定 ‹ 日期 › 位置,点击回最新)。hs 钳热榜源展示。信号流筛选与
 * 分页已迁至独立页 /admin/insight/signals/(M59 批A),总览不再承载。
 * 服务端直查不设读 API。
 */
import Link from "next/link";

import TriggerButtons from "@/components/admin/discovery/TriggerButtons";
import CoverageBoard from "@/components/admin/insight/CoverageBoard";
import HotBoard from "@/components/admin/insight/HotBoard";
import HotBoardDayNav from "@/components/admin/insight/HotBoardDayNav";
import OverviewHero from "@/components/admin/insight/OverviewHero";
import OverviewYield from "@/components/admin/insight/OverviewYield";
import PainCardGrid from "@/components/admin/insight/PainCardGrid";
import { PanelCard } from "@/components/admin/insight/PanelCard";
import RadarTable from "@/components/admin/insight/RadarTable";
import SignalRow from "@/components/admin/insight/SignalRow";
import TrendBoard from "@/components/admin/insight/TrendBoard";
import {
  DOMAIN_ALL,
  WINDOWS,
  chipOff,
  chipOn,
  insightHref,
  resolveDomainView,
  shortSource,
  todayCn,
  type InsightViewParams,
} from "@/components/admin/insight/shared";
import { requireAdminPage } from "@/lib/auth/guard";
import { insightOverview, listInsightClusters, listInsightSignalsPage } from "@/lib/insight/admin";
import { listClusterTrends, countPendingClusters, listSourceMatrix } from "@/lib/insight/trend";
import { TREND_WINDOW_DAYS } from "@/lib/insight/constants";
import { hotBoardForDay, insightKeywordCloud } from "@/lib/insight/hotboard";
import { HOT_SOURCE_KEYS } from "@/lib/insight/hot-source";
import { listTaxonomy } from "@/lib/insight/taxonomy";

export const dynamic = "force-dynamic";

/** 总览「最新信号」预览条数(全量见 /admin/insight/signals/) */
const SIGNAL_PREVIEW_COUNT = 5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AdminInsightPage({
  searchParams,
}: {
  searchParams: Promise<InsightViewParams>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const params: InsightViewParams = {
    w: WINDOWS.some((n) => String(n) === sp.w) ? sp.w : undefined,
    day: DATE_RE.test(sp.day ?? "") ? sp.day : undefined,
    hs: sp.hs !== undefined && HOT_SOURCE_KEYS.has(sp.hs) ? sp.hs : undefined,
  };
  const w = params.w === undefined ? 7 : Number(params.w);
  const today = todayCn();

  // 领域视图(M54 批C):启用域词表供 chips 与参数钳制;all→查询层不筛
  const domainRows = (await listTaxonomy(true)).filter((r) => r.kind === "domain");
  const domainKeys = domainRows.map((r) => r.key);
  const domainLabel = new Map(domainRows.map((r) => [r.key, r.label]));
  const view = resolveDomainView(sp.domain, domainKeys);
  const domainFilter = view === DOMAIN_ALL ? undefined : view;

  const [
    overview,
    painClusters,
    hotClusters,
    signalPreview,
    hotBoard,
    cloud,
    trends,
    matrix,
    pending,
  ] = await Promise.all([
    insightOverview(w, domainFilter),
    listInsightClusters({ kind: "pain", domain: domainFilter, limit: 8 }),
    listInsightClusters({ kind: "hot", domain: domainFilter, limit: 20 }),
    // 预览恒取最新 5 条(全量筛选/分页在 /admin/insight/signals/)
    listInsightSignalsPage({ page: 1, pageSize: SIGNAL_PREVIEW_COUNT }),
    hotBoardForDay(params.day),
    insightKeywordCloud({ windowDays: w, domain: domainFilter }),
    listClusterTrends(TREND_WINDOW_DAYS, domainFilter),
    listSourceMatrix(undefined, domainFilter),
    // 累计中的新簇(成员 < LABEL_MIN_MEMBERS,不进榜;雷达页脚交代去向)
    countPendingClusters(domainFilter, "hot"),
  ]);
  const scored = hotClusters.filter((c) => c.score !== null);
  const hotAvg =
    scored.length === 0 ? null : scored.reduce((a, c) => a + (c.score ?? 0), 0) / scored.length;
  const boards =
    params.hs === undefined ? hotBoard : hotBoard.filter((b) => b.source === params.hs);
  /** 窗口徽章口径:活跃簇=词云取数,信号=insightOverview.daily 求和(窗口内在役源) */
  const windowSignals = overview.daily.reduce((a, d) => a + d.count, 0);
  /** 簇增长分级映射(M52 批B:键=簇 id 字符串,雷达行徽章查表) */
  const trendMap = new Map(trends.map((t) => [String(t.clusterId), t]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">洞察中心</h2>
          <p className="mt-0.5 text-xs text-text-3">
            三层读法:机会分决定写什么 → 外部热度对照 → 信号页钻原始素材;点云图词条入词库驱动发现
          </p>
        </div>
        {/* 手动日批即到即跑;热榜拉取在源管理·台账行内 */}
        <TriggerButtons
          endpoint="/api/insight/trigger"
          jobs={[
            {
              job: "daily",
              label: "立即分析",
              hint: "手动跑一轮 LLM 打标+覆盖度+评分快照,耗时数分钟",
            },
          ]}
        />
      </div>
      {/* 窗口 chips(统计取景)+ 窗口徽章(取景范围可见)+ 领域 chips(M54 批C:
          默认 tech 视图,全部=含未分类;热榜榜面/种子词产出榜不随域)+ dayNav */}
      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map((n) => (
          <Link
            key={n}
            href={insightHref(params, { w: n === 7 ? undefined : String(n) })}
            scroll={false}
            className={w === n ? chipOn : chipOff}
          >
            {n} 天
          </Link>
        ))}
        <span
          className="rounded-sm bg-panel-2 px-2 py-0.5 font-mono text-[11px] text-text-3"
          title={`窗口 chips 只影响词云与本徽章;领域 chips 影响除热榜榜面/种子词产出外全部卡片(KPI 词库两卡恒全局)`}
        >
          近 {w} 天 · {view === DOMAIN_ALL ? "全量" : (domainLabel.get(view) ?? view)} · 活跃簇{" "}
          {cloud.length} · 信号 {windowSignals.toLocaleString()}
        </span>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <Link
          href={insightHref(params, { domain: DOMAIN_ALL })}
          scroll={false}
          className={view === DOMAIN_ALL ? chipOn : chipOff}
          title="全量视图:含未分类信号(分类器未采信/失败的留档)"
        >
          全部
        </Link>
        {domainRows.map((r) => (
          <Link
            key={r.key}
            href={insightHref(params, { domain: r.key === "tech" ? undefined : r.key })}
            scroll={false}
            className={view === r.key ? chipOn : chipOff}
            title={`领域视图:仅 ${r.label} 信号与簇(未分类不进任何领域)`}
          >
            {r.label}
          </Link>
        ))}
      </div>
      <OverviewHero
        cloud={cloud}
        totalSignals={overview.total}
        hotAvg={hotAvg}
        windowDays={w}
        domain={domainFilter}
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PanelCard
          title="机会分趋势"
          hint="按机会分排序 · 点击行进簇详情 · 徽章=近 7 天 vs 前 7 天增长分级(M52)"
        >
          <RadarTable clusters={hotClusters} trends={trendMap} pendingClusters={pending} />
        </PanelCard>
        <PanelCard title="痛点榜" hint="按信号聚合 · 空白标红=选题机会">
          <PainCardGrid clusters={painClusters} />
        </PanelCard>
      </div>
      <PanelCard
        id="source-matrix"
        title="源×簇覆盖矩阵(渠道族)"
        hint="按渠道族看覆盖结构 · 内容空白 = 外部族有热信号 × 站内族零信号 · 一键转选题补覆盖"
      >
        <CoverageBoard matrix={matrix} />
      </PanelCard>
      <PanelCard
        id="trend-board"
        title="跨窗对比"
        hint="近 7 天 vs 前 7 天在役源信号数 · 增长分五级 · 点击簇名进详情"
      >
        <TrendBoard rows={trends} />
      </PanelCard>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PanelCard
          id="hot-board"
          title="热榜信号"
          hint="小时级拉取 · 位次/热度为各站原生口径,不跨源可比"
          tabs={
            <>
              <Link
                href={insightHref(params, { hs: undefined })}
                scroll={false}
                className={params.hs === undefined ? chipOn : chipOff}
              >
                全部
              </Link>
              {hotBoard.map((b) => (
                <Link
                  key={b.source}
                  href={insightHref(params, { hs: b.source })}
                  scroll={false}
                  className={params.hs === b.source ? chipOn : chipOff}
                >
                  {shortSource(b.source)}
                </Link>
              ))}
              <Link
                href="/admin/data/sources/?t=channels"
                title="新增热榜源经 源管理·热榜源 启停接入"
                className="rounded-sm border border-dashed border-line-hover px-2 py-0.5 font-mono text-[11px] text-text-3 hover:text-text-1"
              >
                +渠道
              </Link>
            </>
          }
          extra={<HotBoardDayNav params={params} today={today} />}
        >
          <HotBoard boards={boards} />
        </PanelCard>
        <OverviewYield />
      </div>
      {/* 最新信号预览(M59 批A):完整信号流(筛选/分页/原文外链)迁至独立页 */}
      <PanelCard
        title="最新信号"
        hint={`最近 ${SIGNAL_PREVIEW_COUNT} 条 · 完整信号流按源/地域/介质/日期筛选`}
        extra={
          <Link href="/admin/insight/signals/" className="text-[11px] text-accent hover:underline">
            查看全部 {signalPreview.total.toLocaleString()} 条 →
          </Link>
        }
      >
        {signalPreview.rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12.5px] text-text-3">
            暂无信号——去
            <Link
              href="/admin/data/sources/?t=channels"
              className="mx-0.5 text-accent hover:underline"
            >
              源管理·采集渠道
            </Link>
            检查启停。
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {signalPreview.rows.map((sig) => (
              <SignalRow key={sig.id} sig={sig} showUrl={false} />
            ))}
          </ul>
        )}
      </PanelCard>
    </div>
  );
}
