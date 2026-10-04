/**
 * 采集日历热力图(原型 heat-grid,批C 从 page 抽出):周一对齐 7 行 × 列,
 * 近 N 天入库量四档色阶 + 图例。纯 RSC。
 */

interface CalendarDay {
  day: string;
  count: number;
}

/** 原型 heat-grid 四档色:0 槽色,其余 accent 按 30/60/100% 调入 */
const HEAT_COLORS = [
  "var(--panel-2)",
  "color-mix(in srgb, var(--accent) 30%, var(--panel-2))",
  "color-mix(in srgb, var(--accent) 60%, var(--panel-2))",
  "var(--accent)",
];

function heatStyle(count: number, max: number): React.CSSProperties {
  const level = count <= 0 ? 0 : Math.min(3, Math.ceil((count / Math.max(max, 1)) * 3));
  return { background: HEAT_COLORS[level]! };
}

export default function IngestHeatmap({ calendar }: { calendar: CalendarDay[] }) {
  const maxDay = Math.max(1, ...calendar.map((c) => c.count));
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="border-b border-line px-4 py-3.5 text-sm font-semibold">
        采集日历(近 14 天入库,含隐藏)
      </div>
      <div className="overflow-x-auto p-4">
        <div
          className="grid auto-flow-col grid-rows-7 gap-[3px]"
          style={{ gridAutoColumns: "12px" }}
        >
          {/* 周一对齐:首日前置空格(auto-flow-col 下占满第一列) */}
          {calendar[0] &&
            Array.from(
              { length: (new Date(`${calendar[0].day}T00:00:00Z`).getUTCDay() + 6) % 7 },
              (_, i) => <i key={`pad-${i}`} className="h-3 w-3 rounded-sm" />,
            )}
          {calendar.map((c) => (
            <i
              key={c.day}
              title={`${c.day} — ${c.count} 条`}
              className="h-3 w-3 rounded-sm"
              style={heatStyle(c.count, maxDay)}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-4 font-mono text-[10.5px] text-text-3">
          <span>{calendar[0]?.day}</span>
          <span>{calendar[calendar.length - 1]?.day}</span>
          <span className="ml-auto flex items-center gap-1">
            少
            <i className="h-2.5 w-2.5 rounded-sm bg-panel-2" />
            <i className="h-2.5 w-2.5 rounded-sm bg-accent/30" />
            <i className="h-2.5 w-2.5 rounded-sm bg-accent/60" />
            <i className="h-2.5 w-2.5 rounded-sm bg-accent" />多
          </span>
        </div>
      </div>
    </div>
  );
}
