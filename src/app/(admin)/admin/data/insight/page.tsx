/**
 * 洞察中心(M34 批①雏形→批② 完整形态,方案 docs/plan/insight-plan.md §6):
 * KPI(总量/今日/零结果搜索/日增)+ 痛点榜卡格(核心,覆盖度空白标红)+
 * 热点雷达表 + 分源台账 + 原始信号流(可按源过滤)。纯读无 mutation,服务端
 * 直查不设 API 路由。
 */
import Link from "next/link";

import HotBoard from "@/components/admin/insight/HotBoard";
import KeywordCloud from "@/components/admin/insight/KeywordCloud";
import PainCardGrid from "@/components/admin/insight/PainCardGrid";
import RadarTable from "@/components/admin/insight/RadarTable";
import { SOURCE_LABELS } from "@/components/admin/insight/shared";
import Sparkline from "@/components/admin/usage/Sparkline";
import { requireAdminPage } from "@/lib/auth/guard";
import { insightOverview, listInsightClusters, listInsightSignals } from "@/lib/insight/admin";
import { insightKeywordCloud, latestHotBoard } from "@/lib/insight/hotboard";
import { INSIGHT_SOURCES_ENABLED, type InsightSource } from "@/lib/insight/ingest";

export const dynamic = "force-dynamic";

/** 在役源(白名单序,页签展示与过滤共用) */
const ENABLED_SOURCES = [...INSIGHT_SOURCES_ENABLED] as InsightSource[];

function parseSource(raw: string | undefined): InsightSource | undefined {
  return ENABLED_SOURCES.find((s) => s === raw);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export default async function AdminInsightPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminPage();
  const { source: rawSource } = await searchParams;
  const source = parseSource(rawSource);

  const [overview, painClusters, hotClusters, signals, hotBoard, cloud] = await Promise.all([
    insightOverview(),
    listInsightClusters({ kind: "pain", limit: 8 }),
    listInsightClusters({ kind: "hot", limit: 20 }),
    listInsightSignals({ source, limit: 50 }),
    latestHotBoard(),
    insightKeywordCloud(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">洞察中心</h2>
        <p className="mt-0.5 text-xs text-text-3">
          三层读法:① 选题机会决定「写什么」→ ② 外部热度对照「站外在热什么」(点词可入词库驱动发现) →
          ③ 信号明细钻「原始素材」。管线:外部热榜日频拉取 → 聚类打标 → 机会分;方案见
          docs/plan/insight-plan.md(M34)。
        </p>
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
          <div className="text-xs text-text-3">近 7 日日增</div>
          <div className="mt-2">
            <Sparkline data={overview.daily.map((d) => d.count)} />
          </div>
          <div className="mt-1 font-mono text-[10px] text-text-3">
            {overview.daily[0]?.date.slice(5)} → {overview.daily[6]?.date.slice(5)}
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
          hint="站外在热什么:热榜看当下榜面,云图看 7 日重心;点云图词条可直接入词库驱动发现"
        />
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <h4 className="text-[13px] font-semibold">今日热榜</h4>
            <span className="text-[11px] text-text-3">
              外部渠道最新一批拉取榜面(每日 07:43;位次/热度为各站原生口径,不跨源可比)
            </span>
          </div>
          <HotBoard boards={hotBoard} />
        </div>
        <div>
          <div className="mb-2 flex items-baseline gap-2">
            <h4 className="text-[13px] font-semibold">关键词云图</h4>
            <span className="text-[11px] text-text-3">
              近 7 日活跃已打标簇关键词 × 机会分(字号∝分值);点词入词库,生效词即参与 B站发现
            </span>
          </div>
          <KeywordCloud words={cloud} />
        </div>
      </section>

      {/* ── §3 信号明细(素材层):钻原始信号找直接引语 ── */}
      <section className="flex flex-col gap-2">
        <SectionHead
          no="3"
          title="信号明细"
          hint="原始层:按源过滤钻信号原文,为选题找直接引语与素材"
        />
        <div className="rounded-md border border-line bg-panel">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="text-xs font-medium text-text-2">最近信号</span>
            <Link
              href="/admin/data/insight/"
              scroll={false}
              className={`rounded-sm px-2 py-0.5 font-mono text-[11px] ${
                source === undefined
                  ? "bg-accent-dim text-accent"
                  : "bg-panel-2 text-text-2 hover:text-text-1"
              }`}
            >
              全部
            </Link>
            {ENABLED_SOURCES.map((k) => (
              <Link
                key={k}
                href={`/admin/data/insight/?source=${k}`}
                scroll={false}
                className={`rounded-sm px-2 py-0.5 font-mono text-[11px] ${
                  source === k
                    ? "bg-accent-dim text-accent"
                    : "bg-panel-2 text-text-2 hover:text-text-1"
                }`}
              >
                {SOURCE_LABELS[k]}
              </Link>
            ))}
          </div>
          <table className="w-full text-left text-[13px]">
            <tbody>
              {signals.map((sig) => (
                <tr key={sig.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                  <td className="w-24 px-4 py-2 align-top">
                    <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                      {SOURCE_LABELS[sig.source as InsightSource] ?? sig.source}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="line-clamp-2 text-text-1" title={sig.rawText}>
                      {sig.rawText}
                    </span>
                  </td>
                  <td className="w-28 px-4 py-2 text-right align-top font-mono text-[11px] text-text-3">
                    {formatTime(sig.signalAt)}
                  </td>
                </tr>
              ))}
              {signals.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-xs text-text-3">
                    {source === undefined ? (
                      <>
                        暂无信号:信号由外部热榜日频拉取产生——去
                        <Link
                          href="/admin/data/sources/?t=hot"
                          className="mx-0.5 text-accent hover:underline"
                        >
                          源管理·热榜源
                        </Link>
                        检查启停,或在
                        <Link
                          href="/admin/data/run/?t=plan"
                          className="mx-0.5 text-accent hover:underline"
                        >
                          运行·计划
                        </Link>
                        看排程
                      </>
                    ) : (
                      `「${SOURCE_LABELS[source]}」暂无信号,换个源或等下一轮拉取`
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
