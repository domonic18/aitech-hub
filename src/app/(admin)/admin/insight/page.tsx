/**
 * 洞察中心·分析总览(F11 板):pageHead(窗口 chips + dayNav + 立即分析)→
 * heroRow(关键词云图 + KPI 四竖列 + 日批 status)→ row2(机会分趋势 + 痛点榜)
 * → row3(热榜信号(源 chips 可切)+ 种子词产出榜)→ 信号明细折叠区。取数
 * 页侧一次装配;窗口 chips 钳统计窗口(w),dayNav 钳热榜回看日(day),hs 钳
 * 热榜源展示,from/to 由折叠区信号明细自持。服务端直查不设读 API。
 */
import Link from "next/link";

import TriggerButtons from "@/components/admin/discovery/TriggerButtons";
import HotBoard from "@/components/admin/insight/HotBoard";
import OverviewHero from "@/components/admin/insight/OverviewHero";
import OverviewYield from "@/components/admin/insight/OverviewYield";
import PainCardGrid from "@/components/admin/insight/PainCardGrid";
import RadarTable from "@/components/admin/insight/RadarTable";
import SignalsSection from "@/components/admin/insight/SignalsSection";
import {
  insightHref,
  shiftDay,
  todayCn,
  type InsightViewParams,
} from "@/components/admin/insight/shared";
import { requireAdminPage } from "@/lib/auth/guard";
import { insightOverview, listInsightClusters, listInsightSignals } from "@/lib/insight/admin";
import { hotBoardForDay, insightKeywordCloud } from "@/lib/insight/hotboard";
import { INSIGHT_SOURCES_ENABLED, type InsightSource } from "@/lib/insight/ingest";

export const dynamic = "force-dynamic";

/** 在役源(白名单序,信号明细过滤共用) */
const ENABLED_SOURCES = [...INSIGHT_SOURCES_ENABLED] as InsightSource[];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WINDOWS = [7, 30, 90] as const;

/** 热榜源 chips 短标签(板:百度|知乎|B站) */
const HOT_CHIP_LABELS: Record<string, string> = {
  "hot-baidu": "百度",
  "hot-zhihu": "知乎",
  "hot-bilibili": "B站",
};

const chip = "rounded-sm px-2 py-0.5 font-mono text-[11px]";
const chipOn = `${chip} bg-accent-dim text-accent`;
const chipOff = `${chip} bg-panel-2 text-text-2 hover:text-text-1`;

/** 卡壳(row2/row3 四卡统一:标题 + 一句话读法 + 内容) */
function Card({
  title,
  hint,
  extra,
  children,
}: {
  title: string;
  hint: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-baseline gap-2 border-b border-line px-4 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[11px] text-text-3">{hint}</span>
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
    w: WINDOWS.some((n) => String(n) === sp.w) ? sp.w : undefined,
    day: DATE_RE.test(sp.day ?? "") ? sp.day : undefined,
    hs:
      sp.hs === "hot-baidu" || sp.hs === "hot-zhihu" || sp.hs === "hot-bilibili"
        ? sp.hs
        : undefined,
  };
  const w = params.w === undefined ? 7 : Number(params.w);
  const today = todayCn();

  const [overview, painClusters, hotClusters, signals, hotBoard, cloud] = await Promise.all([
    insightOverview(w),
    listInsightClusters({ kind: "pain", limit: 8 }),
    listInsightClusters({ kind: "hot", limit: 20 }),
    listInsightSignals({ source: params.source as InsightSource | undefined, limit: 50 }),
    hotBoardForDay(params.day),
    insightKeywordCloud({ windowDays: w }),
  ]);
  const scored = hotClusters.filter((c) => c.score !== null);
  const hotAvg =
    scored.length === 0 ? null : scored.reduce((a, c) => a + (c.score ?? 0), 0) / scored.length;
  const boards =
    params.hs === undefined ? hotBoard : hotBoard.filter((b) => b.source === params.hs);

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

      {/* 窗口 chips(统计取景)+ dayNav(热榜回看日,板定头部位置) */}
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
        <span className="ml-auto flex items-center gap-1 text-[11px] text-text-3">
          热榜回看
          <Link
            href={insightHref(params, { day: shiftDay(params.day ?? today, -1) })}
            scroll={false}
            className={chipOff}
            aria-label="前一天"
          >
            ‹
          </Link>
          {params.day !== undefined ? (
            <Link href={insightHref(params, { day: undefined })} scroll={false} className={chipOn}>
              {params.day}
            </Link>
          ) : (
            <span className="font-mono text-text-2">最新</span>
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
        </span>
      </div>

      <OverviewHero cloud={cloud} totalSignals={overview.total} hotAvg={hotAvg} />

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="机会分趋势" hint="按机会分排序 · 点击行进簇详情 · 动量徽=近 24h 方向">
          <RadarTable clusters={hotClusters} />
        </Card>
        <Card title="痛点榜" hint="按信号聚合 · 空白标红=选题机会">
          <PainCardGrid clusters={painClusters} />
        </Card>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card
          title="热榜信号"
          hint="小时级拉取 · 位次/热度为各站原生口径,不跨源可比"
          extra={
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
                  {HOT_CHIP_LABELS[b.source] ?? b.source}
                </Link>
              ))}
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
