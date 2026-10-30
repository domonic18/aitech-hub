/**
 * 跨窗对比分栏(M52 批B):活跃簇按增长分五级分栏——「近 7 天 vs 前 7 天」
 * 在役源信号数对比。行业对标:Google Trends Rising/Breakout 分级 + 趋势
 * 生命周期叙事(🆕新晋/🚀爆发/📈上升/➡️平稳/📉退潮)。各列按增长分降序,
 * chip 显近/前窗计数,点击进簇详情;热/痛色分。服务端纯渲染零状态。
 */
import Link from "next/link";

import { LABEL_MIN_MEMBERS } from "@/lib/insight/constants";
import { TREND_TIER_LABELS, type ClusterTrendRow, type TrendTier } from "@/lib/insight/trend";

const TIER_ORDER: TrendTier[] = ["new", "breakout", "rising", "flat", "declining"];

const COL_HINT: Record<TrendTier, string> = {
  new: "前窗无信号,近窗 ≥3 条",
  breakout: "增长 ≥100%(翻倍)",
  rising: "增长 20%~100%",
  flat: "±20% 内",
  declining: "下滑 ≥20%",
};

function TierCol({ tier, rows }: { tier: TrendTier; rows: ClusterTrendRow[] }): React.ReactElement {
  return (
    <div className="min-w-0 rounded-sm border border-line bg-panel-2/40 p-2">
      <div className="flex items-baseline justify-between">
        {/* 栏头档:表头级(与各表 thead 同档 12)而非行标题档,避免与下方
            13px 簇名同尺寸失层次(M60 字号收敛) */}
        <span className="text-[12px] font-semibold">{TREND_TIER_LABELS[tier]}</span>
        <span className="font-mono text-[10px] text-text-3">{rows.length}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-4 text-text-3">{COL_HINT[tier]}</p>
      <div className="mt-1.5 flex flex-col gap-1">
        {rows.slice(0, 8).map((r) => (
          <Link
            key={r.clusterId}
            href={`/admin/insight/clusters/${r.clusterId}`}
            title={`${r.label ?? "待打标"}:近窗 ${r.recent} / 前窗 ${r.prior} 条`}
            className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 hover:bg-panel-2"
          >
            <span
              className={`shrink-0 rounded-sm px-1 font-mono text-[11px] leading-4 ${
                r.kind === "hot" ? "bg-amber/12 text-amber-hi" : "bg-accent/12 text-accent"
              }`}
            >
              {r.kind === "hot" ? "热" : "痛"}
            </span>
            {r.label ? (
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-1">{r.label}</span>
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-[13px] text-text-3 italic"
                title={`待打标 · 信号样本:${r.sample ?? "—"}(成员 ≥${LABEL_MIN_MEMBERS} 后进入打标队列)`}
              >
                待打标
              </span>
            )}
            <span className="shrink-0 font-mono text-[10px] text-text-3">
              {r.recent}/{r.prior}
            </span>
          </Link>
        ))}
        {rows.length > 8 && <p className="px-1 text-[10px] text-text-3">等 {rows.length} 簇</p>}
        {rows.length === 0 && <p className="px-1 py-1 text-[10px] text-text-3">—</p>}
      </div>
    </div>
  );
}

export default function TrendBoard({ rows }: { rows: ClusterTrendRow[] }): React.ReactElement {
  const byTier = new Map<TrendTier, ClusterTrendRow[]>();
  for (const tier of TIER_ORDER) byTier.set(tier, []);
  for (const r of rows) byTier.get(r.tier)?.push(r);
  for (const [, list] of byTier) list.sort((a, b) => b.growth - a.growth || b.recent - a.recent);
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {TIER_ORDER.map((tier) => (
        <TierCol key={tier} tier={tier} rows={byTier.get(tier) ?? []} />
      ))}
    </div>
  );
}
