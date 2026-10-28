/**
 * 洞察中心·分析总览(F11 板,v2 对齐设计稿):pageHead(窗口 chips + 立即
 * 分析)→ heroRow(关键词云图(舆情四色+图例筛选) + KPI 四竖列 + 日批
 * status)→ row2(机会分趋势 + 痛点榜)→ row3(热榜信号(渠道页签可切,合并
 * 全宽榜)+ 种子词产出榜)→ 信号明细折叠区。取数页侧一次装配;窗口 chips 钳
 * 统计窗口(w)并附窗口统计徽章(窗口只影响词云,KPI 板定固定口径,徽章让
 * 取景范围可见);热榜回看日(day)页签随卡头常驻(板定 ‹ 日期 › 位置,点击
 * 回最新)。hs 钳热榜源展示;from/to 钳信号明细(北京日界,lt 次日零点)。
 * 服务端直查不设读 API。
 */
import Link from "next/link";

import TriggerButtons from "@/components/admin/discovery/TriggerButtons";
import HotBoard from "@/components/admin/insight/HotBoard";
import OverviewHero from "@/components/admin/insight/OverviewHero";
import OverviewYield from "@/components/admin/insight/OverviewYield";
import PainCardGrid from "@/components/admin/insight/PainCardGrid";
import RadarTable from "@/components/admin/insight/RadarTable";
import SourceMatrix from "@/components/admin/insight/SourceMatrix";
import TrendBoard from "@/components/admin/insight/TrendBoard";
import SignalsSection from "@/components/admin/insight/SignalsSection";
import {
  DOMAIN_ALL,
  WINDOWS,
  insightHref,
  resolveDomainView,
  shortSource,
  shiftDay,
  todayCn,
  type InsightViewParams,
} from "@/components/admin/insight/shared";
import { requireAdminPage } from "@/lib/auth/guard";
import { insightOverview, listInsightClusters, listInsightSignals } from "@/lib/insight/admin";
import { listClusterTrends, listSourceMatrix } from "@/lib/insight/trend";
import {
  INSIGHT_MEDIA_VOCAB,
  SIGNAL_TAKE_DEFAULT,
  TREND_WINDOW_DAYS,
} from "@/lib/insight/constants";
import { hotBoardForDay, insightKeywordCloud } from "@/lib/insight/hotboard";
import { HOT_SOURCE_KEYS } from "@/lib/insight/hot-source";
import { INSIGHT_SOURCES_ENABLED, type InsightSource } from "@/lib/insight/ingest";
import { listTaxonomy } from "@/lib/insight/taxonomy";

export const dynamic = "force-dynamic";

/** 在役源(白名单序,信号明细过滤共用) */
const ENABLED_SOURCES = [...INSIGHT_SOURCES_ENABLED] as InsightSource[];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const chip = "rounded-sm px-2 py-0.5 font-mono text-[11px]";
const chipOn = `${chip} bg-accent-dim text-accent`;
const chipOff = `${chip} bg-panel-2 text-text-2 hover:text-text-1`;

/** 卡壳(row2/row3 四卡统一:标题 + 一句话读法 + 页签槽(热榜渠道页签位,
 * F11 v2 板定紧随标题)+ 右侧 extra + 内容;id 供页头控件锚点跳滚) */
function Card({
  title,
  hint,
  tabs,
  extra,
  id,
  children,
}: {
  title: string;
  hint: string;
  tabs?: React.ReactNode;
  extra?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    // min-w-0:grid item 自动最小尺寸会被 truncate(nowrap)标题的 min-content
    // 顶爆——移动端视口下热榜长标题把隐式轨道撑到 877px 整页横滚(M48 验收反馈),
    // 打断 min-content 传播链让 truncate 在视口内真正生效
    <div id={id} className="min-w-0 rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[11px] text-text-3">{hint}</span>
        {tabs !== undefined && <span className="flex flex-wrap items-center gap-1">{tabs}</span>}
        {extra !== undefined && <span className="ml-auto flex items-center gap-1.5">{extra}</span>}
      </div>
      <div className="px-2 py-2">{children}</div>
    </div>
  );
}

export default async function AdminInsightPage({
  searchParams,
}: {
  searchParams: Promise<InsightViewParams>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const params: InsightViewParams = {
    source: ENABLED_SOURCES.find((s) => s === sp.source),
    medium: INSIGHT_MEDIA_VOCAB.find((m) => m === sp.medium),
    w: WINDOWS.some((n) => String(n) === sp.w) ? sp.w : undefined,
    day: DATE_RE.test(sp.day ?? "") ? sp.day : undefined,
    from: DATE_RE.test(sp.from ?? "") ? sp.from : undefined,
    to: DATE_RE.test(sp.to ?? "") ? sp.to : undefined,
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

  const [overview, painClusters, hotClusters, signals, hotBoard, cloud, trends, matrix] =
    await Promise.all([
      insightOverview(w, domainFilter),
      listInsightClusters({ kind: "pain", domain: domainFilter, limit: 8 }),
      listInsightClusters({ kind: "hot", domain: domainFilter, limit: 20 }),
      listInsightSignals({
        source: params.source as InsightSource | undefined,
        // 北京日界折算(表单口径见 SignalsSection:from ≥ 当日零点,to < 次日零点;
        // 此前 from/to 只进 URL 不进查询,日期筛选是空转)
        from: params.from === undefined ? undefined : new Date(`${params.from}T00:00:00+08:00`),
        to:
          params.to === undefined
            ? undefined
            : new Date(`${shiftDay(params.to, 1)}T00:00:00+08:00`),
        medium: params.medium,
        domain: domainFilter,
        limit: SIGNAL_TAKE_DEFAULT,
      }),
      hotBoardForDay(params.day),
      insightKeywordCloud({ windowDays: w, domain: domainFilter }),
      listClusterTrends(TREND_WINDOW_DAYS, domainFilter),
      listSourceMatrix(undefined, domainFilter),
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
            三层读法:机会分决定写什么 → 外部热度对照 → 信号明细钻原始素材;点云图词条入词库驱动发现
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
      <OverviewHero cloud={cloud} totalSignals={overview.total} hotAvg={hotAvg} windowDays={w} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
          title="机会分趋势"
          hint="按机会分排序 · 点击行进簇详情 · 徽章=近 7 天 vs 前 7 天增长分级(M52)"
        >
          <RadarTable clusters={hotClusters} trends={trendMap} />
        </Card>
        <Card title="痛点榜" hint="按信号聚合 · 空白标红=选题机会">
          <PainCardGrid clusters={painClusters} />
        </Card>
      </div>
      <Card
        id="source-matrix"
        title="源×簇覆盖矩阵"
        hint="内容空白 = 热源有需求 × 站内无痛点信号 · 一键转选题补覆盖"
      >
        <SourceMatrix matrix={matrix} />
      </Card>
      <Card
        id="trend-board"
        title="跨窗对比"
        hint="近 7 天 vs 前 7 天在役源信号数 · 增长分五级 · 点击簇名进详情"
      >
        <TrendBoard rows={trends} />
      </Card>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
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
          extra={
            <>
              {params.day !== undefined && (
                <Link
                  href={insightHref(params, { day: undefined })}
                  scroll={false}
                  className={chipOn}
                  title="回看模式:点击回最新榜面"
                >
                  回看 {params.day} ✕
                </Link>
              )}
              <Link
                href={insightHref(params, { day: shiftDay(params.day ?? today, -1) })}
                scroll={false}
                className={chipOff}
                aria-label="前一天"
              >
                ‹
              </Link>
              {params.day !== undefined ? (
                <Link
                  href={insightHref(params, { day: undefined })}
                  scroll={false}
                  className={chipOn}
                  title="回看模式:点击回最新榜面"
                >
                  {params.day}
                </Link>
              ) : (
                <span className="font-mono text-[11px] text-text-2">最新</span>
              )}
              {params.day !== undefined && params.day < today ? (
                <Link
                  href={insightHref(params, { day: shiftDay(params.day, 1) })}
                  scroll={false}
                  className={chipOff}
                  aria-label="后一天"
                >
                  ›
                </Link>
              ) : (
                <span className={`${chip} opacity-40`}>›</span>
              )}
            </>
          }
        >
          <HotBoard boards={boards} />
        </Card>
        <OverviewYield />
      </div>
      {/* 信号明细默认折叠(板定):展开付筛选与 50 条原始信号 */}
      <details className="group rounded-md border border-line bg-panel">
        <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-semibold marker:content-none">
          <span className="flex items-center gap-2">
            <i className="text-[10px] text-text-3 transition-transform group-open:rotate-90">▶</i>
            信号明细
          </span>
          <span className="text-[11px] font-normal text-text-3">
            已折叠 · 最近 50 条 · 展开筛选源与日期
          </span>
        </summary>
        <div className="border-t border-line">
          <SignalsSection
            signals={signals}
            sources={ENABLED_SOURCES}
            params={{ ...params, w: params.w, day: params.day, hs: undefined }}
          />
        </div>
      </details>
    </div>
  );
}
