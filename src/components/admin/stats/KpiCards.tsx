/**
 * 统计页 KPI 四卡(原型 admin-stats ov-grid):今日 PV/UV(涨跌对比昨日,
 * 昨日为 0 显「—」防除零)+ 近 7/30 日 PV/UV。纯 RSC。
 */
import type { VisitOverview } from "@/lib/stats/queries";

const CARD = "rounded-md border border-line bg-panel p-4";

function delta(cur: number, prev: number): { text: string; cls: string } {
  if (prev === 0) return { text: "— vs 昨日 0", cls: "text-text-3" };
  const pct = ((cur - prev) / prev) * 100;
  const arrow = pct >= 0 ? "↑" : "↓";
  const cls = pct >= 0 ? "text-green" : "text-red";
  return {
    text: `${arrow} ${Math.abs(pct).toFixed(1)}% vs 昨日 ${prev.toLocaleString("en-US")}`,
    cls,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function KpiCards({ overview }: { overview: VisitOverview }): React.ReactElement {
  const pv = delta(overview.today.pv, overview.yesterday.pv);
  const uv = delta(overview.today.uv, overview.yesterday.uv);
  const avg7 = Math.round(overview.last7.pv / 7);
  const cards = [
    {
      icon: "i-linechart",
      label: "今日 PV",
      num: fmt(overview.today.pv),
      sub: pv.text,
      subCls: pv.cls,
    },
    {
      icon: "i-user",
      label: "今日 UV",
      num: fmt(overview.today.uv),
      sub: uv.text,
      subCls: uv.cls,
    },
    {
      icon: "i-calendar",
      label: "近 7 日 PV / UV",
      num: fmt(overview.last7.pv),
      sub: `${fmt(overview.last7.uv)} UV · 日均 ${fmt(avg7)} PV`,
      subCls: "text-text-3",
    },
    {
      icon: "i-calendar",
      label: "近 30 日 PV / UV",
      num: fmt(overview.last30.pv),
      sub: `${fmt(overview.last30.uv)} UV · 自新站上线起算`,
      subCls: "text-text-3",
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className={CARD}>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-2">{c.label}</span>
            <svg className="ic text-text-3" aria-hidden="true">
              <use href={`#${c.icon}`} />
            </svg>
          </div>
          <div className="mt-2 font-mono text-[28px] font-semibold leading-9 tracking-[-0.01em]">
            {c.num}
          </div>
          <div className={`mt-1 font-mono text-xs ${c.subCls}`}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
