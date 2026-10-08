"use client";

/**
 * 趋势图 hover 增强(client 岛):最近点吸附十字线 + PV/UV 强调点 +
 * 数据 tip。坐标/数值全部由 lib/stats/chart.ts 服务端算好传入,岛内
 * 只做命中测试,零几何计算、零图表库(DESIGN-SPEC §6)。位置用 viewBox
 * 坐标转百分比,响应式缩放下不错位。触屏无 hover,降级为纯图形(显式注记)。
 */
import { useRef, useState } from "react";

import type { HoverPoint } from "@/lib/stats/chart";
import { TREND_BASELINE, TREND_H, TREND_TOP, TREND_W } from "@/lib/stats/chart";

const pctX = (x: number): string => `${((x / TREND_W) * 100).toFixed(2)}%`;
const pctY = (y: number): string => `${((y / TREND_H) * 100).toFixed(2)}%`;

export default function TrendHover({
  points,
  children,
}: {
  points: HoverPoint[];
  children: React.ReactNode;
}): React.ReactElement {
  const boxRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || points.length === 0) return;
    const vx = ((e.clientX - rect.left) * TREND_W) / rect.width;
    let best = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i]!.x - vx) < Math.abs(points[best]!.x - vx)) best = i;
    }
    setActive(best);
  };

  const p = active === null ? null : points[active]!;
  const atStart = active === 0;
  const atEnd = active === points.length - 1;
  // tip 边缘翻转:两端点不水平居中,防溢出裁切
  const tipAlign = atStart ? "0%" : atEnd ? "-100%" : "-50%";
  const tipTopY = p ? Math.min(p.pvY, p.uvY) : 0;

  return (
    <div
      ref={boxRef}
      className="relative"
      onMouseMove={onMove}
      onMouseLeave={() => setActive(null)}
    >
      {children}
      {p && (
        <>
          {/* 十字线(仅纵向;横向吸附由强调点表达) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute w-px bg-text-3/40"
            style={{
              left: pctX(p.x),
              top: pctY(TREND_TOP),
              bottom: pctY(TREND_H - TREND_BASELINE),
            }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-accent"
            style={{ left: pctX(p.x), top: pctY(p.pvY) }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-green"
            style={{ left: pctX(p.x), top: pctY(p.uvY) }}
          />
          <div
            data-testid="trend-tip"
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-line bg-panel px-2.5 py-1.5 font-mono text-[11px] shadow-md"
            style={{
              left: pctX(p.x),
              top: `calc(${pctY(tipTopY)} - 8px)`,
              transform: `translate(${tipAlign}, -100%)`,
            }}
          >
            <div className="text-text-3">{p.date}</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="flex items-center gap-1 text-text-1">
                <i className="h-[3px] w-3 rounded-full bg-accent" />
                PV {p.pv.toLocaleString("en-US")}
              </span>
              <span className="flex items-center gap-1 text-text-1">
                <i className="h-[3px] w-3 rounded-full bg-green" />
                UV {p.uv.toLocaleString("en-US")}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
