/**
 * 分发中心 KPI 行(F16 板 statsRow):今日分发 / 近 7 天成功率 / 累计分发
 * 三张等宽卡,值大字 + label 小字;成功率无终态样本显 —。
 */
import type { DistributeOverview } from "@/lib/distribute/records";

export default function StatsRow({
  overview,
}: {
  overview: DistributeOverview;
}): React.ReactElement {
  const items: Array<{ value: string; label: string }> = [
    { value: String(overview.todaySynced), label: "今日分发" },
    {
      value: overview.rate7d === null ? "—" : `${Math.round(overview.rate7d * 100)}%`,
      label: "同步成功率(近 7 天)",
    },
    { value: overview.totalSynced.toLocaleString("en-US"), label: "累计分发(全渠道)" },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-md border border-line bg-panel px-4 py-3">
          <div className="text-xl font-semibold text-text-1">{it.value}</div>
          <div className="mt-0.5 text-[11px] text-text-3">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
