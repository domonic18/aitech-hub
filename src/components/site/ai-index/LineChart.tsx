"use client";

import { useMemo, useState } from "react";

export interface LineChartPoint {
  x: number;
  /** null = 当天无数据,曲线在此断开(不填 0,避免被读成「没有冲击」) */
  y: number | null;
  label?: string;
}

interface LineChartProps {
  data: LineChartPoint[];
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  yLogScale?: boolean;
  yUnit?: string;
  xFormatter?: (x: number) => string;
  yFormatter?: (y: number) => string;
  ariaLabel: string;
  /** 参考线(如能力基线):虚线 + 右侧标签,说明曲线与它的关系 */
  reference?: { y: number; label: string } | null;
}

const MARGIN = { top: 24, right: 24, bottom: 48, left: 72 };
/** tooltip 尺寸(与下面渲染的 rect 一致) */
const TIP_W = 92;
const TIP_H = 44;
const AXIS_FILL = "var(--text-3)";
const GRID_STROKE = "var(--border)";
const LINE_COLOR = "var(--accent, #2563eb)";
const DOT_COLOR = "var(--accent, #2563eb)";
const AREA_TOP = "var(--accent, #2563eb)";

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e15) return `${(n / 1e15).toFixed(1)}Q`;
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n * 100) / 100);
}

function niceTicks(min: number, max: number, logScale: boolean, count = 5): number[] {
  if (logScale) {
    const logMin = Math.log10(Math.max(min, 1e-12));
    const logMax = Math.log10(max);
    const step = Math.ceil((logMax - logMin) / count);
    const ticks: number[] = [];
    for (let v = Math.floor(logMin); v <= Math.ceil(logMax); v += Math.max(step, 1)) {
      ticks.push(10 ** v);
    }
    return ticks;
  }
  if (min === max) {
    return [min - 1, min, min + 1].filter(Number.isFinite);
  }
  const range = max - min;
  const rough = range / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step; v += step) {
    ticks.push(v);
  }
  return ticks;
}

/**
 * 把点集转成平滑三次贝塞尔路径(Catmull-Rom)。
 * 返回值以 "M x y" 开头,后续为 "C ..." 指令。
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const ps = [points[0], ...points, points[points.length - 1]];

  let d = `M ${ps[1].x} ${ps[1].y}`;
  for (let i = 1; i < ps.length - 2; i++) {
    const p0 = ps[i - 1];
    const p1 = ps[i];
    const p2 = ps[i + 1];
    const p3 = ps[i + 2];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** 去掉 smoothPath 的起始 "M",只留曲线指令(用于拼接面积填充) */
function curveCommands(path: string): string {
  return path.replace(/^M [\d.-]+ [\d.-]+\s*/, "");
}

export function LineChart({
  data,
  width = 720,
  height = 360,
  xLabel,
  yLabel,
  yLogScale = false,
  yUnit = "",
  xFormatter = (x: number) => String(x),
  yFormatter = formatNumber,
  ariaLabel,
  reference = null,
}: LineChartProps): React.ReactElement {
  const [hover, setHover] = useState<number | null>(null);

  const plot = {
    left: MARGIN.left,
    top: MARGIN.top,
    right: width - MARGIN.right,
    bottom: height - MARGIN.bottom,
  };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;

  const { xTicks, yTicks, xScale, yScale } = useMemo(() => {
    const xs = data.map((d) => d.x);
    const rawXMin = Math.min(...xs);
    const rawXMax = Math.max(...xs);
    const xPadding = (rawXMax - rawXMin) * 0.02 || 1;
    const xMin = rawXMin - xPadding;
    const xMax = rawXMax + xPadding;

    let yMin: number;
    let yMax: number;
    if (yLogScale) {
      const positiveYs = data.map((d) => d.y).filter((y): y is number => y !== null && y > 0);
      yMin = Math.min(...positiveYs);
      yMax = Math.max(...positiveYs);
    } else {
      const ys = data.map((d) => d.y).filter((y): y is number => y !== null);
      if (reference !== null && Number.isFinite(reference.y)) ys.push(reference.y);
      const rawYMin = Math.min(...ys);
      const rawYMax = Math.max(...ys);
      const yPadding = (rawYMax - rawYMin) * 0.1 || 1;
      yMin = rawYMin - yPadding;
      yMax = rawYMax + yPadding;
    }

    const xTicks = niceTicks(xMin, xMax, false, 6);
    const yTicks = niceTicks(yMin, yMax, yLogScale, 5);

    function xScale(x: number): number {
      return plot.left + ((x - xMin) / (xMax - xMin)) * plotWidth;
    }

    function yScale(y: number): number {
      if (yLogScale) {
        const logMin = Math.log10(yMin);
        const logMax = Math.log10(yMax);
        return plot.bottom - ((Math.log10(y) - logMin) / (logMax - logMin)) * plotHeight;
      }
      return plot.bottom - ((y - yMin) / (yMax - yMin)) * plotHeight;
    }

    return { xTicks, yTicks, xScale, yScale };
  }, [data, yLogScale, plot.bottom, plot.left, plotHeight, plotWidth, reference]);

  const scaledPoints = useMemo(
    () => data.map((d) => ({ x: xScale(d.x), y: d.y === null ? null : yScale(d.y), raw: d })),
    [data, xScale, yScale],
  );

  // 按 null 切段:每段独立成一条平滑曲线
  const segments = useMemo(() => {
    const segs: { x: number; y: number }[][] = [];
    let current: { x: number; y: number }[] = [];
    for (const p of scaledPoints) {
      if (p.y === null) {
        if (current.length > 0) segs.push(current);
        current = [];
        continue;
      }
      current.push({ x: p.x, y: p.y });
    }
    if (current.length > 0) segs.push(current);
    return segs;
  }, [scaledPoints]);

  const segmentPaths = useMemo(
    () =>
      segments.map((seg) => {
        const line = smoothPath(seg);
        const baseline = plot.bottom;
        const area =
          seg.length === 0
            ? ""
            : `M ${seg[0].x} ${baseline} L ${seg[0].x} ${seg[0].y} ${curveCommands(line)} L ${seg[seg.length - 1].x} ${baseline} Z`;
        return { line, area };
      }),
    [segments, plot.bottom],
  );

  const nearestPoint = useMemo(() => {
    if (hover === null || scaledPoints.length === 0) return null;
    const boundedX = Math.max(plot.left, Math.min(hover, plot.right));
    let best: (typeof scaledPoints)[number] | null = null;
    let bestDist = Infinity;
    for (const p of scaledPoints) {
      if (p.y === null) continue;
      const dist = Math.abs(p.x - boundedX);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    return best !== null && bestDist < plotWidth / scaledPoints.length + 8 ? best : null;
  }, [hover, scaledPoints, plot.left, plot.right, plotWidth]);

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = width / rect.width;
    setHover((e.clientX - rect.left) * scaleX);
  }

  /**
   * tooltip 落位:默认在点的右上,越界时翻到另一侧,再夹回绘图区内。
   * (根 <svg> 默认 overflow hidden,越出 viewBox 的部分会被裁掉。)
   */
  const tipPos = useMemo(() => {
    if (!nearestPoint || nearestPoint.y === null) return null;
    let x = nearestPoint.x + 12;
    if (x + TIP_W > plot.right) x = nearestPoint.x - 12 - TIP_W;
    x = Math.max(plot.left, Math.min(x, plot.right - TIP_W));
    let y = nearestPoint.y - 36;
    if (y < plot.top) y = nearestPoint.y + 12;
    y = Math.max(plot.top, Math.min(y, plot.bottom - TIP_H));
    return { x, y };
  }, [nearestPoint, plot.left, plot.right, plot.top, plot.bottom]);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full min-w-[360px]"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id="lineChartArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AREA_TOP} stopOpacity="0.28" />
            <stop offset="100%" stopColor={AREA_TOP} stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="lineChartLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={LINE_COLOR} />
            <stop offset="100%" stopColor={LINE_COLOR} />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {yTicks.map((t) => (
          <line
            key={`gy-${t}`}
            x1={plot.left}
            x2={plot.right}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke={GRID_STROKE}
            strokeOpacity={0.35}
            strokeDasharray="3 3"
          />
        ))}
        {xTicks.map((t) => (
          <line
            key={`gx-${t}`}
            x1={xScale(t)}
            x2={xScale(t)}
            y1={plot.top}
            y2={plot.bottom}
            stroke={GRID_STROKE}
            strokeOpacity={0.25}
            strokeDasharray="2 4"
          />
        ))}
        {/* Axes */}
        <line
          x1={plot.left}
          x2={plot.right}
          y1={plot.bottom}
          y2={plot.bottom}
          stroke={AXIS_FILL}
          strokeOpacity={0.6}
          strokeWidth={1.5}
        />
        <line
          x1={plot.left}
          x2={plot.left}
          y1={plot.top}
          y2={plot.bottom}
          stroke={AXIS_FILL}
          strokeOpacity={0.6}
          strokeWidth={1.5}
        />
        {/* Area fill + smooth line(按段绘制,null 处断开) */}
        {segmentPaths.map((seg, i) => (
          <g key={`seg-${i}`}>
            {seg.area && <path d={seg.area} fill="url(#lineChartArea)" stroke="none" />}
            {seg.line && (
              <path
                d={seg.line}
                fill="none"
                stroke="url(#lineChartLine)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </g>
        ))}
        {/* Reference line (e.g. capability baseline) */}
        {reference !== null && Number.isFinite(reference.y) && (
          <g>
            <line
              x1={plot.left}
              x2={plot.right}
              y1={yScale(reference.y)}
              y2={yScale(reference.y)}
              stroke={AXIS_FILL}
              strokeOpacity={0.7}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text
              x={plot.right}
              y={yScale(reference.y) - 6}
              textAnchor="end"
              fontSize={10}
              fill="var(--text-2)"
            >
              {reference.label}
            </text>
          </g>
        )}
        {/* Dots */}{" "}
        {scaledPoints.map((p, i) =>
          p.y === null ? null : (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={3.5}
                fill="var(--panel)"
                stroke={DOT_COLOR}
                strokeWidth={2}
              />
              {p.raw.label && (
                <text
                  x={p.x > plot.right - 40 ? p.x + 4 : p.x < plot.left + 40 ? p.x - 4 : p.x}
                  y={p.y - 12 < 10 ? p.y + 16 : p.y - 12}
                  textAnchor={
                    p.x > plot.right - 40 ? "end" : p.x < plot.left + 40 ? "start" : "middle"
                  }
                  fontSize={10}
                  fill="var(--text-2)"
                >
                  {p.raw.label}
                </text>
              )}
            </g>
          ),
        )}
        {/* Ticks */}
        {xTicks.map((t) => (
          <text
            key={`tx-${t}`}
            x={xScale(t)}
            y={plot.bottom + 18}
            textAnchor="middle"
            fontSize={10}
            fill={AXIS_FILL}
          >
            {xFormatter(t)}
          </text>
        ))}
        {yTicks.map((t) => (
          <text
            key={`ty-${t}`}
            x={plot.left - 10}
            y={yScale(t) + 3}
            textAnchor="end"
            fontSize={10}
            fill={AXIS_FILL}
          >
            {yFormatter(t)}
            {yUnit}
          </text>
        ))}
        {/* Axis labels */}
        {xLabel && (
          <text
            x={(plot.left + plot.right) / 2}
            y={height - 10}
            textAnchor="middle"
            fontSize={11}
            fill={AXIS_FILL}
          >
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text
            transform={`translate(18 ${(plot.top + plot.bottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={11}
            fill={AXIS_FILL}
          >
            {yLabel}
          </text>
        )}
        {/* Hover crosshair and tooltip */}
        {nearestPoint && nearestPoint.y !== null && tipPos && (
          <g>
            <line
              x1={nearestPoint.x}
              x2={nearestPoint.x}
              y1={plot.top}
              y2={plot.bottom}
              stroke={AXIS_FILL}
              strokeOpacity={0.25}
              strokeDasharray="4 4"
            />
            <circle
              cx={nearestPoint.x}
              cy={nearestPoint.y}
              r={6}
              fill={DOT_COLOR}
              stroke="var(--panel)"
              strokeWidth={2.5}
            />
            <g transform={`translate(${tipPos.x} ${tipPos.y})`}>
              <rect
                x={0}
                y={0}
                width={TIP_W}
                height={TIP_H}
                rx={6}
                fill="var(--panel-2)"
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text x={TIP_W / 2} y={18} textAnchor="middle" fontSize={10} fill="var(--text-2)">
                {xFormatter(nearestPoint.raw.x)}
              </text>
              <text
                x={TIP_W / 2}
                y={34}
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                fill="var(--text-1)"
              >
                {yFormatter(nearestPoint.raw.y ?? 0)}
                {yUnit}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
