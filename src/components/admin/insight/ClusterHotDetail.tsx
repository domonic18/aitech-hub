/**
 * F25 机会簇详情(hot 形态):页头(机会簇 · label + 窗口 chips + 加入词库)→
 * heroRow(机会分卡 + 近 8 周趋势条 | KPI 4)→ 核心词表(近 {w} 日频次 vs 前
 * {w} 日 → 趋势徽,加词库/已在词库)→ 代表信号 4 条 + 可写角度卡(生成选题
 * 占位)。数据簇详情 + extras 见 lib/insight/admin。
 */
import Link from "next/link";

import AddWordsButton from "@/components/admin/insight/AddWordsButton";
import TopicGenButton from "@/components/admin/insight/TopicGenButton";
import {
  CoverageBadge,
  MediaBadges,
  SOURCE_LABELS,
  formatTime,
  writeAngleLine,
} from "@/components/admin/insight/shared";
import type { InsightClusterDetail } from "@/lib/insight/admin";
import type { InsightClusterExtras } from "@/lib/insight/cluster-extras";

const WINDOWS = [7, 30, 90] as const;

/** 簇详情内窗口 chips href(仅 w 一个口径,直构) */
function clusterHref(id: string, w: number, active: boolean): string {
  const sp = new URLSearchParams();
  if (!active) sp.set("w", String(w));
  const q = sp.toString();
  return `/admin/insight/clusters/${id}${q === "" ? "" : `?${q}`}`;
}

/** 趋势徽:前窗为零→新兴;现值显著高→上升;显著低→回落;余持平 */
function trendOf(freq: number, prevFreq: number): { label: string; cls: string } {
  if (prevFreq === 0 && freq > 0) return { label: "↑ 新兴", cls: "text-green" };
  if (freq >= prevFreq * 1.2 + 0.5) return { label: "↑ 上升", cls: "text-green" };
  if (freq * 1.2 + 0.5 <= prevFreq) return { label: "↓ 回落", cls: "text-red" };
  return { label: "→ 持平", cls: "text-text-3" };
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-md border border-line bg-panel px-3.5 py-2.5">
      <div className="text-xs text-text-3">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-text-1">{value}</div>
    </div>
  );
}

export default function ClusterHotDetail({
  detail,
  extras,
  windowDays,
}: {
  detail: InsightClusterDetail;
  extras: InsightClusterExtras;
  windowDays: number;
}): React.ReactElement {
  const c = detail.cluster;
  const w = windowDays;
  const snaps = c.snapshots;
  const last = snaps[snaps.length - 1];
  const prev = snaps[snaps.length - 2];
  const delta =
    last !== undefined && prev !== undefined ? Math.round(last.score - prev.score) : null;
  const maxScore = Math.max(...snaps.map((s) => s.score), 1);
  const lexiconSet = new Set(extras.lexiconWords.map((x) => x.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/insight/" className="text-xs text-text-3 hover:text-accent">
            ← 洞察中心
          </Link>
          <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
            热点#{c.id}
          </span>
          {c.status === "fading" && (
            <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-3">
              退热
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">机会簇 · {c.label ?? "待打标簇"}</h2>
          <span className="flex items-center gap-1">
            {WINDOWS.map((n) => (
              <Link
                key={n}
                href={clusterHref(c.id, w, w === n)}
                scroll={false}
                className={`rounded-sm px-2 py-0.5 font-mono text-[11px] ${
                  w === n ? "bg-accent-dim text-accent" : "bg-panel-2 text-text-2 hover:text-text-1"
                }`}
              >
                {n} 天
              </Link>
            ))}
          </span>
          {c.keywords.length > 0 && <AddWordsButton words={c.keywords} label="加入词库" />}
        </div>
        {c.summary !== null && <p className="mt-1 text-[13px] text-text-2">{c.summary}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <MediaBadges media={c.media} />
          <CoverageBadge score={c.coverageScore} state={c.coverageState} />
          {c.keywords.map((k) => (
            <span key={k} className="rounded-sm bg-panel-2 px-1.5 py-0.5 text-[11px] text-text-2">
              #{k}
            </span>
          ))}
        </div>
        <p className="mt-2 font-mono text-[11px] text-text-3">
          {c.members} 条信号 · 首见 {formatTime(c.firstSeenAt)} · 最近 {formatTime(c.lastSeenAt)}
          {c.peakAt !== null && ` · 峰值 ${formatTime(c.peakAt)}`}
        </p>
      </div>

      {/* heroRow:机会分卡(带 8 周趋势条)| KPI 4 竖排 */}
      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-md border border-line bg-panel px-4 py-3">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
            <div>
              <div className="text-xs text-text-3">机会分(综合热度×内容缺口×竞争度)</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="font-mono text-3xl font-semibold text-text-1">
                  {c.score === null ? "—" : Math.round(c.score)}
                </span>
                {delta !== null && delta !== 0 && (
                  <span
                    className={`font-mono text-xs ${delta > 0 ? "text-green" : "text-red"}`}
                    title="最近一次日批快照与前一日快照之差"
                  >
                    {delta > 0 ? "+" : ""}
                    {delta} 较前日
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-[11px] text-text-3">近 8 周机会分趋势</div>
            {snaps.length < 2 ? (
              <p className="mt-2 text-[11px] text-text-3">快照累积中:日批每日 03:57 一拍</p>
            ) : (
              <div className="mt-1 flex h-12 items-end gap-px" aria-hidden>
                {snaps.map((s) => (
                  <span
                    key={s.date}
                    title={`${s.date} · ${Math.round(s.score)}`}
                    className="min-w-0 flex-1 rounded-t-sm bg-accent/45"
                    style={{ height: `${Math.max(6, (s.score / maxScore) * 100)}%` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Kpi label="30 日信号" value={`${extras.sig30d} 条`} />
          <Kpi
            label="关联候选"
            value={
              <>
                {extras.lexiconWords.length} 条
                {extras.lexiconPending > 0 && (
                  <span className="text-xs font-normal text-amber-hi">
                    {" "}
                    · 待审 {extras.lexiconPending}
                  </span>
                )}
              </>
            }
          />
          <Kpi label="已产出文章" value={`${extras.producedPosts} 篇`} />
          <Kpi label="涉及渠道" value={`${detail.sourceDist.length} 个`} />
        </div>
      </div>

      {/* 核心词表:窗口 chips 钳频次窗宽 */}
      <div className="overflow-hidden rounded-md border border-line bg-panel">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">
          核心词
          <span className="ml-2 text-[11px] font-normal text-text-3">
            频次=簇成员信号文本命中(近 {w} 日 vs 前 {w} 日)
          </span>
        </div>
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2 font-medium">核心词</th>
              <th className="px-3 py-2 font-medium">近 {w} 日信号频次</th>
              <th className="px-3 py-2 font-medium">趋势</th>
              <th className="px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {extras.coreWords
              .sort((a, b) => b.freq - a.freq)
              .map((cw) => {
                const t = trendOf(cw.freq, cw.prevFreq);
                const inLexicon = lexiconSet.has(cw.word.toLowerCase());
                return (
                  <tr
                    key={cw.word}
                    className="border-b border-line last:border-b-0 hover:bg-panel-2"
                  >
                    <td className="px-4 py-2 font-medium text-text-1">{cw.word}</td>
                    <td className="px-3 py-2 font-mono text-text-2">
                      {cw.freq}
                      <span className="ml-1.5 text-[11px] text-text-3">前窗 {cw.prevFreq}</span>
                    </td>
                    <td className={`px-3 py-2 text-xs ${t.cls}`}>{t.label}</td>
                    <td className="px-4 py-2">
                      {inLexicon ? (
                        <span className="text-xs text-text-3" title="已在种子词库">
                          已在词库
                        </span>
                      ) : (
                        <AddWordsButton words={[cw.word]} label="加词库" />
                      )}
                    </td>
                  </tr>
                );
              })}
            {extras.coreWords.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-xs text-text-3">
                  {c.keywords.length === 0 ? "簇未打标,无核心词" : "窗口内成员信号未命中核心词"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-md border border-line bg-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">代表信号</span>
            <span className="text-[11px] text-text-3">完整信号流见 洞察中心 · 信号明细</span>
          </div>
          <ul>
            {detail.signals.slice(0, 4).map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-panel-2"
              >
                <span className="w-16 shrink-0 pt-0.5">
                  <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                    {SOURCE_LABELS[s.source as keyof typeof SOURCE_LABELS] ?? s.source}
                  </span>
                </span>
                <span className="min-w-0 flex-1 text-[13px] text-text-1" title={s.rawText}>
                  <span className="line-clamp-2">{s.rawText}</span>
                </span>
                <span className="shrink-0 pt-0.5 font-mono text-[11px] text-text-3">
                  {formatTime(s.signalAt)}
                </span>
              </li>
            ))}
            {detail.signals.length === 0 && (
              <li className="px-4 py-8 text-center text-xs text-text-3">暂无成员信号</li>
            )}
          </ul>
        </div>

        <div className="rounded-md border border-line bg-panel px-4 py-3">
          <div className="text-sm font-semibold">可写角度</div>
          <p className="mt-1 text-[11px] text-text-3">AI 依据内容缺口生成(当前为覆盖度派生)</p>
          <p className="mt-2 text-[13px] leading-relaxed text-text-2">
            {writeAngleLine(c.coverageState)}
          </p>
          {c.summary !== null && (
            <p className="mt-2 border-t border-line pt-2 text-xs leading-relaxed text-text-3">
              簇概括:{c.summary}
            </p>
          )}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-text-3">选题生成排期中</span>
            <TopicGenButton />
          </div>
        </div>
      </div>
    </div>
  );
}
