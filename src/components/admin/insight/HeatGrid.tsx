/**
 * 30 日热力格(M34 批②,方案 §6 热点雷达):每日快照分 → 色块行,深浅=分数
 * 相对序列最大值;缺日灰格。纯 SVG-free div 实现(零新依赖,Sparkline 同取向)。
 */
export default function HeatGrid({
  points,
  days = 30,
}: {
  points: { date: string; score: number }[];
  days?: number;
}): React.ReactElement {
  const sliced = points.slice(-days);
  const pad = Math.max(0, days - sliced.length);
  const max = Math.max(...sliced.map((p) => p.score), 1);
  const cells: ({ date: string; score: number } | null)[] = [
    ...Array.from({ length: pad }, () => null),
    ...sliced,
  ];
  return (
    <div className="flex flex-wrap gap-[3px]" aria-label="近 30 日热度">
      {cells.map((c, i) =>
        c === null ? (
          <span key={i} className="h-3.5 w-3.5 rounded-[2px] bg-panel-2" />
        ) : (
          <span
            key={i}
            className="h-3.5 w-3.5 rounded-[2px] bg-accent"
            style={{ opacity: 0.15 + 0.85 * Math.min(c.score / max, 1) }}
            title={`${c.date}  机会分 ${Math.round(c.score)}`}
          />
        ),
      )}
    </div>
  );
}
