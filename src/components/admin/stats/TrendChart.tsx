/**
 * PV/UV 趋势卡(原型 admin-stats):手写内联 SVG(几何由
 * lib/stats/chart.ts 服务端算好),零图表库;hover 数据提示由
 * TrendHover client 岛增强(静态图形仍 RSC 直出)。分段切换
 * URL 驱动(Link),保留 hot 参数。
 */
import Link from "next/link";

import TrendHover from "@/components/admin/stats/TrendHover";
import type { DayPoint } from "@/lib/stats/chart";
import { TREND_H, TREND_W, buildTrendGeometry } from "@/lib/stats/chart";

const RANGES = [7, 30, 90] as const;

function href(trend: number, hot: string): string {
  return `/admin/?trend=${trend}&hot=${hot}`;
}

export default function TrendChart({
  series,
  trend,
  hot,
}: {
  series: DayPoint[];
  trend: 7 | 30 | 90;
  hot: string;
}): React.ReactElement {
  const g = buildTrendGeometry(series);
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4">
        <h3 className="text-sm font-semibold">PV / UV 趋势</h3>
        <div className="flex items-center gap-3 text-xs text-text-2">
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-full bg-accent" />
            PV(页面浏览)
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-3.5 rounded-full bg-green" />
            UV(独立访客)
          </span>
        </div>
        <div className="ml-auto flex overflow-hidden rounded-sm border border-line">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={href(r, hot)}
              className={`border-r border-line px-3 py-1.5 text-xs last:border-r-0 ${
                r === trend
                  ? "bg-accent-dim font-semibold text-accent"
                  : "bg-panel text-text-2 hover:bg-panel-2"
              }`}
            >
              近 {r} 天
            </Link>
          ))}
        </div>
      </div>
      <div className="p-4">
        {series.length === 0 ? (
          <div className="flex h-[252px] items-center justify-center font-mono text-sm text-text-3">
            暂无数据
          </div>
        ) : (
          <TrendHover points={g.hoverPoints}>
            <svg
              viewBox={`0 0 ${TREND_W} ${TREND_H}`}
              className="block w-full"
              role="img"
              aria-label="PV/UV 趋势图"
            >
              <defs>
                <linearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--accent)" stopOpacity="0.18" />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {g.gridLines.map((l) => (
                <g key={l.y}>
                  <line x1={52} x2={TREND_W - 16} y1={l.y} y2={l.y} stroke="var(--border)" />
                  <text
                    x={44}
                    y={l.y + 4}
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--text-3)"
                    fontFamily="var(--font-mono)"
                  >
                    {l.value.toLocaleString("en-US")}
                  </text>
                </g>
              ))}
              <path d={g.areaPath} fill="url(#pvFill)" />
              <polyline
                points={g.pvPoints}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <polyline
                points={g.uvPoints}
                fill="none"
                stroke="var(--green)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {g.xLabels.map((l) => (
                <text
                  key={l.x}
                  x={l.x}
                  y={TREND_H - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-3)"
                  fontFamily="var(--font-mono)"
                >
                  {l.text}
                </text>
              ))}
            </svg>
          </TrendHover>
        )}
      </div>
    </div>
  );
}
