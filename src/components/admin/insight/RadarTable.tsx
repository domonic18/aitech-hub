/**
 * 热点雷达(M34 批③ 验收三轮:改动量榜)——回答「什么在升温」:显式名次
 * (头部三色,同今日热榜语法)+ 动量徽(新晋/↑升温/→平稳/↓退潮,读侧按
 * 近 24h 新增 vs 此前累计判定)+ 机会分热度条 + 成员数与相对活跃时间。
 * 快照序列尚薄(<3 点),趋势迷你图暂撤,动量徽承担方向职责。
 */
import Link from "next/link";

import type { InsightClusterRow } from "@/lib/insight/admin";
import type { ClusterMomentum } from "@/lib/insight/scoring";
import { TREND_TIER_LABELS, type ClusterTrendRow, type TrendTier } from "@/lib/insight/trend";

import { AnomalyBadge, clusterHref } from "./shared";

/** 名次头部三色(与 HotBoard 同一套视觉语言) */
function rankClass(rank: number): string {
  if (rank === 1) return "font-semibold text-red";
  if (rank === 2) return "font-semibold text-amber-hi";
  if (rank === 3) return "font-semibold text-amber";
  return "text-text-3";
}

const MOMENTUM_META: Record<ClusterMomentum, { text: string; cls: string; title: string }> = {
  burst: { text: "新晋", cls: "bg-red/12 text-red", title: "近 24h 新增≥3 且此前≈0,正在爆发" },
  rising: { text: "↑升温", cls: "bg-green/12 text-green", title: "近 24h 新增占比≥40%" },
  steady: { text: "→平稳", cls: "bg-panel-2 text-text-3", title: "活跃度持平" },
  cooling: { text: "↓退潮", cls: "bg-panel-2 text-text-3", title: "近 24h 零新增,逐步冷却" },
};

/** 增长分五态徽章(M52 批B:近 7 天 vs 前 7 天,取代 24h 单点方向;无趋势行
 * 的簇回退 24h 形态) */
const TREND_CLS: Record<TrendTier, string> = {
  new: "bg-red/12 text-red",
  breakout: "bg-red/12 text-red",
  rising: "bg-green/12 text-green",
  flat: "bg-panel-2 text-text-3",
  declining: "bg-panel-2 text-text-3",
};

function TrendBadge({ tier, growth }: { tier: TrendTier; growth: number }): React.ReactElement {
  const pct = `${growth >= 0 ? "+" : ""}${Math.round(growth * 100)}%`;
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-4 ${TREND_CLS[tier]}`}
      title={`近 7 天 vs 前 7 天在役源信号增长 ${pct}`}
    >
      {TREND_TIER_LABELS[tier]}
    </span>
  );
}

function MomentumBadge({ m }: { m: ClusterMomentum }): React.ReactElement {
  const meta = MOMENTUM_META[m];
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-4 ${meta.cls}`}
      title={meta.title}
    >
      {meta.text}
    </span>
  );
}

function relTime(iso: string | null): string {
  if (iso === null) return "—";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}时前`;
  return `${Math.floor(h / 24)}天前`;
}

function RadarRow({
  c,
  rank,
  maxScore,
  trends,
}: {
  c: InsightClusterRow;
  rank: number;
  maxScore: number;
  trends?: ReadonlyMap<string, ClusterTrendRow>;
}): React.ReactElement {
  const trend = trends?.get(String(c.id));
  const kws = c.keywords
    .slice(0, 3)
    .map((k) => `#${k}`)
    .join(" ");
  return (
    <Link
      href={clusterHref(c.id)}
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-panel-2"
    >
      <span className={`w-5 shrink-0 text-right font-mono text-[12px] ${rankClass(rank)}`}>
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] text-text-1" title={c.label ?? undefined}>
            {c.label ?? "待打标簇"}
          </span>
          {trend ? (
            <TrendBadge tier={trend.tier} growth={trend.growth} />
          ) : (
            <MomentumBadge m={c.momentum} />
          )}
          {c.anomaly && <AnomalyBadge />}
        </span>
        {kws !== "" && (
          <span className="block truncate text-[11px] text-text-3" title={kws}>
            {kws}
          </span>
        )}
      </span>
      <span className="hidden h-1 w-14 shrink-0 overflow-hidden rounded-full bg-panel-2 sm:block">
        {c.score !== null && maxScore > 0 && (
          <span
            className="block h-full rounded-full bg-accent opacity-70"
            style={{ width: `${Math.max(4, (c.score / maxScore) * 100)}%` }}
          />
        )}
      </span>
      <span className="w-7 shrink-0 text-right font-mono text-[12px] text-text-2">
        {c.score !== null ? Math.round(c.score) : "—"}
      </span>
      <span
        className="w-14 shrink-0 text-right font-mono text-[10px] leading-4 text-text-3"
        title={`${c.members} 条信号 · 最近活跃 ${relTime(c.recentAt)}`}
      >
        {c.members}·{relTime(c.recentAt)}
      </span>
    </Link>
  );
}

export default function RadarTable({
  clusters,
  trends,
}: {
  clusters: InsightClusterRow[];
  /** 簇增长分级(M52 批B;键=簇 id 字符串;缺省回退 24h 动量徽) */
  trends?: ReadonlyMap<string, ClusterTrendRow>;
}): React.ReactElement {
  if (clusters.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel px-4 py-8 text-center text-xs text-text-3">
        热点簇暂空:热榜信号拉取并打标后进入雷达——检查
        <Link href="/admin/data/sources/?t=channels" className="mx-0.5 text-accent hover:underline">
          源管理·热榜源
        </Link>
        启停,或用 CLI <code className="font-mono">insight:run -- cluster</code> 手动跑一轮
      </div>
    );
  }
  const maxScore = Math.max(...clusters.map((c) => c.score ?? 0), 0);
  // 自 F11 起宿主于页侧 Card 壳(F11 板),自身不再画面板框
  return (
    <div className="grid gap-x-4 lg:grid-cols-2">
      {clusters.map((c, i) => (
        <RadarRow key={c.id} c={c} rank={i + 1} maxScore={maxScore} trends={trends} />
      ))}
    </div>
  );
}
