"use client";

/**
 * 牌价散点图(M74 批D):输入价 × 输出价 的对数坐标散点,**零 JS SVG**。
 *
 * 沿用 /leaderboards 的散点纪律(手写 SVG、禁图表库;hover 卡用 CSS 驱动,
 * 原生 `<title>` 退役——系统气泡 ~1s 延迟且需精准命中小点)。
 *
 * 每个点 = 一个模型**最便宜的一家**报价(「这个模型最便宜能多少钱」);
 * 颜色按提供商区分;完全免费(0 价)取不了对数坐标 → 不入图,在图下说明数量。
 */
import { buildPriceScatter } from "@/lib/pricing/scatter";
import type { PublicModelRow } from "@/lib/pricing/public";

/** 提供商配色(前 8 家上色,其余灰) */
const PROVIDER_COLORS = [
  "#58a6ff",
  "#3fb950",
  "#d29922",
  "#db61a2",
  "#a371f7",
  "#f85149",
  "#39c5cf",
  "#bc8cff",
];

export function PriceScatter({ rows }: { rows: PublicModelRow[] }): React.ReactElement {
  const geo = buildPriceScatter(rows);

  if (geo.points.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-text-3">
        当前筛选下没有可入图的正价报价(完全免费模型价格为 0,取不了对数坐标)
      </p>
    );
  }

  // 提供商 → 颜色(按报价家数排序,多的先占位)
  const counts = new Map<string, number>();
  for (const p of geo.points) counts.set(p.providerKey, (counts.get(p.providerKey) ?? 0) + 1);
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const colorOf = (key: string): string => {
    const i = ordered.indexOf(key);
    return i >= 0 && i < PROVIDER_COLORS.length ? PROVIDER_COLORS[i]! : "#6e7681";
  };

  const { plot } = geo;
  return (
    <div className="px-4 py-3">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          className="w-full min-w-[640px]"
          role="img"
          aria-label="输入价与输出价散点图"
        >
          {/* 网格与刻度 */}
          {geo.yTicks.map((t) => (
            <g key={`y${t.v}`}>
              <line
                x1={plot.left}
                x2={plot.right}
                y1={t.pos}
                y2={t.pos}
                stroke="var(--line)"
                strokeDasharray="2 4"
              />
              <text
                x={plot.left - 8}
                y={t.pos + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-3)"
              >
                {t.label}
              </text>
            </g>
          ))}
          {geo.xTicks.map((t) => (
            <g key={`x${t.v}`}>
              <line
                x1={t.pos}
                x2={t.pos}
                y1={plot.top}
                y2={plot.bottom}
                stroke="var(--line)"
                strokeDasharray="2 4"
              />
              <text
                x={t.pos}
                y={plot.bottom + 16}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-3)"
              >
                {t.label}
              </text>
            </g>
          ))}
          {/* 轴名 */}
          <text x={plot.left} y={plot.top - 8} fontSize="10" fill="var(--text-3)">
            ↑ 输出价(每百万 tokens)
          </text>
          <text
            x={plot.right}
            y={geo.height - 6}
            textAnchor="end"
            fontSize="10"
            fill="var(--text-3)"
          >
            输入价(每百万 tokens)→
          </text>

          {/* 点 + 悬停卡 */}
          {geo.points.map((p) => (
            <g key={p.id} className="pc-pt">
              <circle
                cx={p.x}
                cy={p.y}
                r="4"
                fill={colorOf(p.providerKey)}
                fillOpacity="0.85"
                stroke="var(--panel)"
                strokeWidth="0.8"
                className="pc-dot"
              />
              <g className="pc-tip">
                <rect
                  x={Math.min(p.x + 8, plot.right - 190)}
                  y={Math.max(p.y - 42, plot.top)}
                  width="184"
                  height="38"
                  rx="4"
                  fill="var(--panel-strong)"
                  stroke="var(--line-strong)"
                />
                <text
                  x={Math.min(p.x + 16, plot.right - 182)}
                  y={Math.max(p.y - 26, plot.top + 16)}
                  fontSize="11"
                  fill="var(--text-1)"
                >
                  {p.displayName.slice(0, 22)}
                </text>
                <text
                  x={Math.min(p.x + 16, plot.right - 182)}
                  y={Math.max(p.y - 12, plot.top + 30)}
                  fontSize="10"
                  fill="var(--text-3)"
                >
                  {p.providerName.slice(0, 14)} · 输入 {p.input} / 输出 {p.output}
                </text>
              </g>
            </g>
          ))}
        </svg>
      </div>

      {/* 图例 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-text-3">
        {ordered.map((key) => (
          <span key={key} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: colorOf(key) }}
              aria-hidden
            />
            {key}
          </span>
        ))}
        {geo.skipped > 0 && (
          <span className="text-amber">{geo.skipped} 个模型为 0 价(完全免费),未入图</span>
        )}
        {geo.currencies.length > 1 && (
          <span className="text-amber">图中含多币种,跨币种点不可直接比大小</span>
        )}
      </div>
    </div>
  );
}
