/**
 * 近 7 日时段热力(M34 批③ 可视化增强):周一→周日 × 0-23 时格子矩阵,
 * 深浅=信号密度(峰值归一,HeatGrid 同取向);北京墙钟口径。纯 div 零依赖。
 */
import type { InsightHourCell } from "@/lib/insight/trends";

const DOW_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function HourHeat({ cells }: { cells: InsightHourCell[] }): React.ReactElement {
  const bySlot = new Map(cells.map((c) => [`${c.dow}|${c.hour}`, c.count]));
  const max = Math.max(...cells.map((c) => c.count), 1);
  return (
    <div>
      <div className="flex gap-2">
        <div className="flex flex-col gap-[3px]">
          {ROW_ORDER.map((d) => (
            <span
              key={d}
              className="flex h-3 w-8 items-center justify-end text-[10px] leading-none text-text-3"
            >
              {DOW_LABELS[d]}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-[3px]">
            {ROW_ORDER.map((d) => (
              <div key={d} className="flex gap-[3px]">
                {Array.from({ length: 24 }, (_, h) => {
                  const v = bySlot.get(`${d}|${h}`) ?? 0;
                  return (
                    <span
                      key={h}
                      className={`h-3 min-w-0 flex-1 rounded-[2px] ${v === 0 ? "bg-panel-2" : "bg-accent"}`}
                      style={v === 0 ? undefined : { opacity: 0.15 + 0.85 * (v / max) }}
                      title={`${DOW_LABELS[d]} ${h} 时 · ${v} 条`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-10 font-mono text-[10px] text-text-3">
        <span>0时</span>
        <span>6时</span>
        <span>12时</span>
        <span>18时</span>
        <span>23时</span>
      </div>
    </div>
  );
}
