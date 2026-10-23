/**
 * 洞察中心(M34 批①雏形→批② 完整形态,方案 docs/plan/insight-plan.md §6):
 * KPI(总量/今日/窗口日增)+ 痛点榜卡格(核心,覆盖度空白标红)+ 热点雷达表 +
 * 外部热榜(可回看历史日)+ 关键词云 + 原始信号流(源/日期范围过滤,分区已
 * 抽 SignalsSection)。服务端直查不设读 API;页头「立即分析」经
 * /api/insight/trigger 手动跑日批(验收二批①)。
 * 验收二批②:数据层本就增量累积,读侧开放历史——w 切统计窗口(7/30/90),
 * day 回看热榜榜面,from/to 钳信号明细。
 */
import Link from "next/link";

import TriggerButtons from "@/components/admin/discovery/TriggerButtons";
import HotBoard from "@/components/admin/insight/HotBoard";
import KeywordCloud from "@/components/admin/insight/KeywordCloud";
import PainCardGrid from "@/components/admin/insight/PainCardGrid";
import RadarTable from "@/components/admin/insight/RadarTable";
import SignalsSection from "@/components/admin/insight/SignalsSection";
import {
  insightHref,
  shiftDay,
  todayCn,
  type InsightViewParams,
} from "@/components/admin/insight/shared";
import Sparkline from "@/components/admin/usage/Sparkline";
import { requireAdminPage } from "@/lib/auth/guard";
import { insightOverview, listInsightClusters, listInsightSignals } from "@/lib/insight/admin";
import { hotBoardForDay, insightKeywordCloud } from "@/lib/insight/hotboard";
import { INSIGHT_SOURCES_ENABLED, type InsightSource } from "@/lib/insight/ingest";

export const dynamic = "force-dynamic";

/** 在役源(白名单序,页签展示与过滤共用) */
const ENABLED_SOURCES = [...INSIGHT_SOURCES_ENABLED] as InsightSource[];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WINDOWS = [7, 30, 90] as const;

/** 北京日界 → 信号表 [from, to) 区间(to=次日零点) */
function dayRange(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00+08:00`);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

/** 分区头(批③ 三分区读法):编号徽 + 标题 + 一句话读法 */
function SectionHead({
  no,
  title,
  hint,
}: {
  no: string;
  title: string;
  hint: string;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-baseline gap-2 border-b border-line pb-1.5">
      <span className="rounded-sm bg-accent-dim px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent">
        {no}
      </span>
      <h3 className="text-sm font-bold">{title}</h3>
      <span className="text-[11px] text-text-3">{hint}</span>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel px-4 py-3">
      <div className="text-xs text-text-3">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold text-text-1">{value}</div>
      {hint !== undefined && <div className="mt-0.5 text-[11px] text-text-3">{hint}</div>}
    </div>
  );
}

const chip = "rounded-sm px-2 py-0.5 font-mono text-[11px]";
const chipOn = `${chip} bg-accent-dim text-accent`;
const chipOff = `${chip} bg-panel-2 text-text-2 hover:text-text-1`;

export default async function AdminInsightPage({
  searchParams,
}: {
  searchParams: Promise<InsightViewParams>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const sp = await searchParams;
  const source = ENABLED_SOURCES.find((s) => s === sp.source);
  const params: InsightViewParams = {
    source,
    w: WINDOWS.some((n) => String(n) === sp.w) ? sp.w : undefined,
    from: DATE_RE.test(sp.from ?? "") ? sp.from : undefined,
    to: DATE_RE.test(sp.to ?? "") ? sp.to : undefined,
    day: DATE_RE.test(sp.day ?? "") ? sp.day : undefined,
  };
  const w = params.w === undefined ? 7 : Number(params.w);
  const today = todayCn();

  // 日期范围只钳信号明细:from 缺省不限,to 含当日(lt 次日零点)
  const range = {
    ...(params.from === undefined ? {} : { from: dayRange(params.from).from }),
    ...(params.to === undefined ? {} : { to: dayRange(params.to).to }),
  };

  const [overview, painClusters, hotClusters, signals, hotBoard, cloud] = await Promise.all([
    insightOverview(w),
    listInsightClusters({ kind: "pain", limit: 8 }),
    listInsightClusters({ kind: "hot", limit: 20 }),
    listInsightSignals({ source, ...range, limit: 50 }),
    hotBoardForDay(params.day),
    insightKeywordCloud({ windowDays: w }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">洞察中心</h2>
          <p className="mt-0.5 text-xs text-text-3">
            三层读法:① 选题机会决定「写什么」→ ② 外部热度对照「站外在热什么」(点词可入词库驱动发现)
            → ③ 信号明细钻「原始素材」。管线:外部热榜小时级拉取 → 聚类打标 → 机会分;方案见
            docs/plan/insight-plan.md(M34)。
          </p>
        </div>
        {/* 手动触发(验收二批①):日批打标即到即跑,不必等 03:57 排程;热榜拉取在源管理·热榜源 */}
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

      {/* 统计窗口(验收二批②):信号/簇/快照逐日累积,窗口只是读侧取景 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-3">统计窗口</span>
        {WINDOWS.map((n) => (
          <Link
            key={n}
            href={insightHref(params, { w: n === 7 ? undefined : String(n) })}
            scroll={false}
            className={w === n ? chipOn : chipOff}
          >
            近{n}天
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="信号总量" value={overview.total.toLocaleString()} />
        <KpiCard label="今日新增" value={overview.today.toLocaleString()} />
        <KpiCard
          label="在役渠道"
          value={String(overview.bySource.length)}
          hint="外部热榜三源(百度/知乎/B站)"
        />
        <div className="rounded-md border border-line bg-panel px-4 py-3">
          <div className="text-xs text-text-3">近 {w} 日日增</div>
          <div className="mt-2">
            <Sparkline data={overview.daily.map((d) => d.count)} />
          </div>
          <div className="mt-1 font-mono text-[10px] text-text-3">
            {overview.daily[0]?.date.slice(5)} →{" "}
            {overview.daily[overview.daily.length - 1]?.date.slice(5)}
          </div>
        </div>
      </div>

      {/* ── §1 选题机会(决策层):机会分直指「下一篇写什么」 ── */}
      <section className="flex flex-col gap-3">
        <SectionHead
          no="1"
          title="选题机会"
          hint="先看这层决定写什么:空白标红=没人写过,动量徽告诉你在升温还是退潮"
        />
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <h4 className="text-[13px] font-semibold">痛点榜</h4>
            <span className="text-[11px] text-text-3">
              信号簇 × 内容覆盖度;空白标红 = 选题机会(机会分 = 介质 40 + 近 7 日热度 30 + 空白 30)
            </span>
          </div>
          <PainCardGrid clusters={painClusters} />
        </div>
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <h4 className="text-[13px] font-semibold">热点雷达</h4>
            <span className="text-[11px] text-text-3">
              按机会分排序;动量徽=近 24h 新增信号方向(新晋/升温/平稳/退潮),热度条∝分值;30
              日热力格见簇详情
            </span>
          </div>
          <RadarTable clusters={hotClusters} />
        </div>
      </section>

      {/* ── §2 外部热度(环境层):与选题机会交叉验证 ── */}
      <section className="flex flex-col gap-3">
        <SectionHead
          no="2"
          title="外部热度"
          hint="站外在热什么:热榜看榜面(可回看),云图看窗口重心;点云图词条可直接入词库驱动发现"
        />
        <div>
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h4 className="text-[13px] font-semibold">{params.day ? "热榜回看" : "最新热榜"}</h4>
            <span className="text-[11px] text-text-3">
              外部渠道榜面(小时级拉取 :43;位次/热度为各站原生口径,不跨源可比;回看取当日最后一批)
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-[11px]">
              <Link
                href={insightHref(params, { day: shiftDay(params.day ?? today, -1) })}
                scroll={false}
                className={chipOff}
                aria-label="前一天"
              >
                ‹ 前一天
              </Link>
              <span className="font-mono text-text-2">{params.day ?? "最新"}</span>
              {params.day !== undefined && (
                <>
                  <Link
                    href={insightHref(params, {
                      day: params.day < today ? shiftDay(params.day, 1) : undefined,
                    })}
                    scroll={false}
                    className={params.day < today ? chipOff : "pointer-events-none opacity-40"}
                    aria-label="后一天"
                  >
                    后一天 ›
                  </Link>
                  <Link
                    href={insightHref(params, { day: undefined })}
                    scroll={false}
                    className={chipOff}
                  >
                    回最新
                  </Link>
                </>
              )}
            </span>
          </div>
          <HotBoard boards={hotBoard} />
        </div>
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <h4 className="text-[13px] font-semibold">关键词云图</h4>
            <span className="text-[11px] text-text-3">
              近 {w} 日活跃已打标簇关键词 × 机会分(字号∝分值);点词入词库,生效词即参与 B站发现
            </span>
          </div>
          <KeywordCloud words={cloud} />
        </div>
      </section>

      {/* ── §3 信号明细(素材层):钻原始信号找直接引语(源/日期过滤,验收二批②) ── */}
      <section className="flex flex-col gap-2">
        <SectionHead
          no="3"
          title="信号明细"
          hint="原始层:按源与日期范围钻信号原文,为选题找直接引语与素材"
        />
        <SignalsSection signals={signals} sources={ENABLED_SOURCES} params={params} />
      </section>
    </div>
  );
}
