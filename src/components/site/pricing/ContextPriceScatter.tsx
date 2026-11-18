"use client";

/**
 * 能力 × 价格 散点(2026-11-18 站长反馈「缺可视化,方便看到模型的能力与价格
 * 水平」):上下文 token 数(能力代理)× 输入价,对数双轴,零 JS SVG。
 *
 * 沿用 PriceScatter 纪律与同款 CSS(.pc-pt/.pc-tip 悬停卡):每模型一点
 * (最便宜一家)、仅 token 计价行;0 价(完全免费)/ 未公布价格 / 未标注
 * 上下文的行不入图,计入图下说明。
 */
import { parseContextTokens, type PublicModelRow } from "@/lib/pricing/public";
import { buildContextPriceScatter } from "@/lib/pricing/scatter";

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

function fmtContext(tokens: number): string {
  if (tokens >= 1024 * 1024) {
    return `${(tokens / (1024 * 1024)).toString().replace(/\.0$/, "")}M`;
  }
  return `${Math.round(tokens / 1024)}K`;
}

export function ContextPriceScatter({ rows }: { rows: PublicModelRow[] }): React.ReactElement {
  const geo = buildContextPriceScatter(rows, parseContextTokens);

  if (geo.points.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-text-3">
        当前筛选下没有同时具备「上下文标注 + 正价输入价」的模型(完全免费 0 价 / 未公布 价格 /
        未标注上下文的不入图)
      </p>
    );
  }

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
          aria-label="上下文长度与输入价散点图(能力 × 价格)"
        >
          {geo.yTicks.map((t) => (
            <g key={`y${t.v}`}>
              <line
                x1={plot.left}
                x2={plot.right}
                y1={t.pos}
                y2={t.pos}
                stroke="var(--border)"
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
                stroke="var(--border)"
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
            ↑ 输入价(每百万 tokens)
          </text>
          <text
            x={plot.right}
            y={geo.height - 6}
            textAnchor="end"
            fontSize="10"
            fill="var(--text-3)"
          >
            上下文长度(tokens)→ 能力越右越强
          </text>

          {geo.points.map((p) => (
            <g key={p.id} className="pc-pt">
              <circle
                cx={p.x}
                cy={p.y}
                r="4"
                fill={colorOf(p.providerKey)}
                fillOpacity="0.85"
                stroke="var(--panel-2)"
                strokeWidth="0.8"
                className="pc-dot"
              />
              <g className="pc-tip">
                <rect
                  x={Math.min(p.x + 8, plot.right - 200)}
                  y={Math.max(p.y - 42, plot.top)}
                  width="194"
                  height="38"
                  rx="4"
                  fill="var(--panel-2)"
                  stroke="var(--border)"
                />
                <text
                  x={Math.min(p.x + 16, plot.right - 192)}
                  y={Math.max(p.y - 26, plot.top + 16)}
                  fontSize="11"
                  fill="var(--text-1)"
                >
                  {p.displayName.slice(0, 22)}
                </text>
                <text
                  x={Math.min(p.x + 16, plot.right - 192)}
                  y={Math.max(p.y - 12, plot.top + 30)}
                  fontSize="10"
                  fill="var(--text-3)"
                >
                  上下文 {fmtContext(p.contextTokens)} · 输入 {p.currency === "USD" ? "$" : "¥"}
                  {p.input} · {p.providerName.slice(0, 12)}
                </text>
              </g>
            </g>
          ))}
        </svg>
      </div>

      {/* 图例 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-text-3">
        <span>左下=便宜窗口小 · 右上=强但贵 · 左上=便宜又强</span>
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
          <span className="text-amber">
            另 {geo.skipped} 个模型未入图(0 价完全免费 / 未公布价格 / 未标注上下文)
          </span>
        )}
        {geo.currencies.length > 1 && (
          <span className="text-amber">图中含多币种,跨币种点不可直接比大小</span>
        )}
      </div>
    </div>
  );
}
