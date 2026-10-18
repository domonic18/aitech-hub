/**
 * 分源占比条(M34 批③ 可视化增强):单条横向堆叠条+图例,展示在役源信号
 * 构成(宽度=总量占比);置于分源台账表头。纯展示,数据=overview.bySource。
 */
import type { InsightSourceStat } from "@/lib/insight/admin";
import type { InsightSource } from "@/lib/insight/ingest";

import { SOURCE_COLORS, SOURCE_LABELS } from "./shared";

export default function SourceShareBar({
  stats,
}: {
  stats: InsightSourceStat[];
}): React.ReactElement {
  const total = stats.reduce((acc, s) => acc + s.total, 0);
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-panel-2">
        {stats
          .filter((s) => s.total > 0)
          .map((s) => (
            <span
              key={s.source}
              className={SOURCE_COLORS[s.source as InsightSource]}
              style={{ width: `${(s.total / total) * 100}%` }}
              title={`${SOURCE_LABELS[s.source as InsightSource]} ${s.total.toLocaleString()} 条`}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {stats.map((s) => (
          <span key={s.source} className="inline-flex items-center gap-1.5 text-[11px] text-text-2">
            <span className={`h-2 w-2 rounded-[2px] ${SOURCE_COLORS[s.source as InsightSource]}`} />
            {SOURCE_LABELS[s.source as InsightSource]}
            <span className="font-mono text-text-1">{s.total.toLocaleString()}</span>
            <span className="font-mono text-text-3">
              {total > 0 ? `${Math.round((s.total / total) * 100)}%` : "—"}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
