/**
 * 日消耗趋势柱图(M14 批⑦,原型 admin-usage.html chart):纯 RSC div 柱,
 * title 悬停读数;零数据画基线,不引图表库(KISS,与采集日历同款取向)。
 */
import { fmtTokens } from "./usage-format";

export default function UsageTrend({
  daily,
}: {
  daily: Array<{ date: string; tokens: number }>;
}): React.ReactElement {
  const max = Math.max(...daily.map((d) => d.tokens), 1);
  return (
    <div className="flex items-end gap-[3px] px-4 pt-4">
      {daily.map((d) => (
        <div
          key={d.date}
          className="min-w-[4px] flex-1 rounded-t-[2px] bg-accent opacity-80 transition-opacity hover:opacity-100"
          style={{ height: `${Math.max(2, (d.tokens / max) * 160)}px` }}
          title={`${d.date} · ${fmtTokens(d.tokens)} tokens`}
        />
      ))}
    </div>
  );
}
