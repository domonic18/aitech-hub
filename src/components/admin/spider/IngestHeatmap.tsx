/**
 * 采集日历热力图(原型 admin-spider heat-grid;2026-10-06 验收反馈问题2 对齐原型):
 * 近 12 周 84 格、accent 日历图标标题 + 副标、五档日期刻度轴与图例同行
 * space-between(DESIGN-SPEC 热力图硬约定:84 格 color-mix 4 档 + 日期轴
 * space-between,子元素禁 margin-left:auto)。周一对齐 7 行 × 列流(几何内联声明,
 * 见网格处注记);格/图例圆角 2px 同原型(--r-sm 6px 落在 12px 格上呈圆点,不可用);纯 RSC。
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
  const weeks = Math.max(1, Math.round(calendar.length / 7));
  // 刻度轴:首/末 + 三等分点,共 5 个 MM-DD(原型月度刻度 space-between 口径)
  const ticks = [
    ...new Set([0, 1, 2, 3, 4].map((i) => Math.round(((calendar.length - 1) * i) / 4))),
  ]
    .map((i) => calendar[i]?.day)
    .filter((d): d is string => Boolean(d))
    .map((d) => d.slice(5));
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-3.5 text-sm font-semibold">
        <svg className="ic text-accent" aria-hidden="true">
          <use href="#i-calendar" />
        </svg>
        采集日历
        <span className="font-mono text-[11px] font-normal text-text-3">
          近 {weeks} 周 · 每日入流条数(含隐藏)
        </span>
      </div>
      <div className="overflow-x-auto p-4">
        {/* 网格几何内联声明,逐条等效原型 .heat-grid 三行 CSS——
            不用 Tailwind 工具类:auto-flow-col 是无效类名(正确名为 grid-flow-col),
            类名不生成时 row 流会沿 7 行模板竖排(实测 86 格拉出 ~1287px 高,2026-10-06) */}
        <div
          className="grid gap-[3px]"
          style={{
            gridAutoFlow: "column",
            gridTemplateRows: "repeat(7, 12px)",
            gridAutoColumns: "12px",
          }}
        >
          {/* 周一对齐:首日前置空格(auto-flow-col 下占满第一列) */}
          {calendar[0] &&
            Array.from(
              { length: (new Date(`${calendar[0].day}T00:00:00Z`).getUTCDay() + 6) % 7 },
              (_, i) => <i key={`pad-${i}`} className="h-3 w-3 rounded-[2px]" />,
            )}
          {calendar.map((c) => (
            <i
              key={c.day}
              title={`${c.day} — ${c.count} 条`}
              className="h-3 w-3 rounded-[2px]"
              style={heatStyle(c.count, maxDay)}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-text-3">
          {ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
          <span className="flex items-center gap-1">
            少
            {HEAT_COLORS.map((c) => (
              <i key={c} className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />
            ))}
            多
          </span>
        </div>
      </div>
    </div>
  );
}
