"use client";

import Link from "next/link";

import type { AiIndexDailyRow } from "@/lib/ai-index/read";
import { parseTopEvents } from "@/lib/ai-index/top-events";

interface AiIndexCardProps {
  recent: AiIndexDailyRow[];
  latest: AiIndexDailyRow | null;
}

export function AiIndexCard({ recent, latest }: AiIndexCardProps): React.ReactElement {
  const indexData = recent.map((r) => ({ x: new Date(r.date).getTime(), y: r.intelligenceIndex }));
  const hasData = indexData.length > 0;

  const latestIndex = latest?.intelligenceIndex ?? indexData[indexData.length - 1]?.y ?? 0;
  const previousIndex = indexData[indexData.length - 2]?.y ?? latestIndex;
  const delta = latestIndex - previousIndex;

  const topEvent = latest ? parseTopEvents(latest.topEvents)[0] : null;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-4 py-2.5 text-[13.5px] font-bold">
        <svg className="ic text-text-2" aria-hidden="true">
          <use href="#i-thunderbolt" />
        </svg>
        AI 智能指数
        <span className="ml-auto font-mono text-[11px] font-normal tracking-wider text-text-3">
          [INDEX]
        </span>
      </div>
      <div className="px-4 pb-3.5 pt-3">
        <div className="flex items-end gap-4">
          <div>
            <p className="text-[11px] text-text-3">智能指数</p>
            <p className="text-xl font-bold text-text-1">
              {hasData ? latestIndex.toFixed(1) : "—"}
            </p>
          </div>
          {hasData && (
            <div className="mb-0.5">
              <p className="text-[11px] text-text-3">较昨日</p>
              <p
                className={`text-sm font-semibold ${delta >= 0 ? "text-green-hi" : "text-red-hi"}`}
              >
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}
              </p>
            </div>
          )}
        </div>
        <div className="mt-3">
          <MiniSparkline data={indexData} />
        </div>
        {topEvent && (
          <p className="mt-3 truncate text-xs leading-relaxed text-text-2">
            <span className="text-text-3">当日最大冲击：</span>
            {topEvent.title}
          </p>
        )}
        {!hasData && (
          <p className="mt-3 text-xs leading-relaxed text-text-3">
            等待首次日终聚合,能力水位与冲击脉冲将在此显示。
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-text-3">
          能力水位取自 Epoch AI 公开 ECI 数据,冲击脉冲来自电报流中真正与 AI 相关的事件。
        </p>
        <div className="mt-3 border-t border-line/60 pt-2.5 text-center">
          <Link href="/ai-index/" className="text-[13px] text-text-2 hover:text-accent-hover">
            查看完整指数 →
          </Link>
        </div>
      </div>
    </div>
  );
}

interface DataPoint {
  x: number;
  y: number;
}

function MiniSparkline({ data }: { data: DataPoint[] }): React.ReactElement {
  if (data.length < 2) return <div className="h-10 w-full rounded bg-panel-2" />;

  const width = 280;
  const height = 48;
  const padding = 4;

  const ys = data.map((d) => d.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const yRange = maxY - minY || 1;

  const xScale = (i: number) => padding + (i / (data.length - 1)) * (width - padding * 2);
  const yScale = (y: number) => height - padding - ((y - minY) / yRange) * (height - padding * 2);

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d.y)}`).join(" ");

  const areaPath = `${path} L ${xScale(data.length - 1)} ${height - padding} L ${xScale(0)} ${height - padding} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="AI 智能指数迷你趋势"
    >
      <defs>
        <linearGradient id="aiIndexGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#aiIndexGradient)" />
      <path
        d={path}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={xScale(data.length - 1)}
        cy={yScale(data[data.length - 1].y)}
        r={2.5}
        fill="var(--accent)"
      />
    </svg>
  );
}
