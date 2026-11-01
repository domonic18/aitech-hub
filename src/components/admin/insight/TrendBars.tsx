/**
 * 近 7 日分源堆叠柱(M34 批③ 可视化增强):每日一柱按源堆叠(白名单序自底
 * 向上),色=源固定映射 shared.SOURCE_COLORS;柱高按七日峰值归一,零日画基线。
 * 纯 div 零依赖(Sparkline 同取向)。
 */
import type { InsightSource } from "@/lib/insight/ingest";
import type { InsightTrendDay } from "@/lib/insight/trend-series";

import { SOURCE_COLORS, SOURCE_LABELS } from "./shared";

const H = 96;

export default function TrendBars({
  days,
  sources,
}: {
  days: InsightTrendDay[];
  sources: InsightSource[];
}): React.ReactElement {
  const dayTotal = (d: InsightTrendDay): number =>
    sources.reduce((acc, s) => acc + (d.bySource[s] ?? 0), 0);
  const max = Math.max(...days.map(dayTotal), 1);
  const legend = sources.filter((s) => days.some((d) => (d.bySource[s] ?? 0) > 0));

  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: H + 18 }}>
        {days.map((d) => {
          const total = dayTotal(d);
          return (
            <div
              key={d.date}
              className="flex flex-1 flex-col items-center gap-1.5"
              title={`${d.date.slice(5)} · 共 ${total} 条`}
            >
              <div className="flex w-full flex-col-reverse overflow-hidden" style={{ height: H }}>
                {total === 0 ? (
                  <span className="h-[2px] w-full rounded-[1px] bg-panel-2" />
                ) : (
                  sources.map((s) => {
                    const v = d.bySource[s] ?? 0;
                    if (v === 0) return null;
                    return (
                      <span
                        key={s}
                        className={`w-full ${SOURCE_COLORS[s]}`}
                        style={{ height: Math.max(3, (v / max) * H) }}
                        title={`${SOURCE_LABELS[s]} ${v} 条`}
                      />
                    );
                  })
                )}
              </div>
              <span className="font-mono text-[10px] text-text-3">{d.date.slice(5)}</span>
            </div>
          );
        })}
      </div>
      {legend.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {legend.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[11px] text-text-2">
              <span className={`h-2 w-2 rounded-[2px] ${SOURCE_COLORS[s]}`} />
              {SOURCE_LABELS[s]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
