/**
 * 访客地区卡(2026-11-25 方案① 一期):近 7 日地区分布条形排行,国内省级与
 * 境外国家混排(pv 降序,来源 stats_region_daily);尾部给境内/境外合计。
 * 解析口径同 IP 归属标注(方案②):国内省、境外国家;未解析到地区的 PV
 * 不入本表(合计小于全站 PV 属预期)。纯 RSC。
 */
import type { RegionPanelData } from "@/lib/stats/queries";

export default function RegionPanel({ panel }: { panel: RegionPanelData }): React.ReactElement {
  const pct = (pv: number): number => (panel.totalPv === 0 ? 0 : (pv / panel.totalPv) * 100);
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center gap-3 px-5 pt-4">
        <h3 className="text-sm font-semibold">访客地区</h3>
        <span className="font-mono text-[10px] text-text-3">[REGIONS · 近 7 日]</span>
      </div>
      <div className="flex flex-col gap-2.5 p-5 pt-3">
        {panel.rows.length === 0 && (
          <p className="py-8 text-center font-mono text-xs text-text-3">暂无地区数据</p>
        )}
        {panel.rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-[minmax(96px,150px)_minmax(0,1fr)_auto] items-center gap-3"
          >
            <div className="min-w-0">
              <span className="block truncate text-[13px] text-text-1" title={r.label}>
                {r.label}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.max(pct(r.pv), 0.5).toFixed(1)}%` }}
              />
            </div>
            <div className="text-right font-mono text-xs text-text-2">
              {r.pv.toLocaleString("en-US")} · {pct(r.pv).toFixed(1)}%
            </div>
          </div>
        ))}
        {panel.rows.length > 0 && (
          <p className="mt-1 border-t border-dashed border-line pt-3 font-mono text-[11px] leading-relaxed text-text-3">
            境内 {panel.domesticPv.toLocaleString("en-US")} · 境外{" "}
            {panel.overseasPv.toLocaleString("en-US")} PV;境外访客按国家计,UV 按 IP+UA
            匿名哈希日去重;未解析地区的访问不入本表
          </p>
        )}
      </div>
    </div>
  );
}
