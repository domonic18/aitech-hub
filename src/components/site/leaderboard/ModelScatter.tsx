/**
 * 智能指数散点图(M63,RSC 零交互):几何由 lib/leaderboard/scatter.ts 算好,
 * 本组件只把点/刻度/标签画成内联 SVG(DESIGN-SPEC §6 禁图表库)。
 * 每点包 <a> + 原生 <title>(键盘可达、零 JS tooltip);开源权重用空心圆
 * 而非颜色区分;移动端整图隐藏,改出前 10 名列表。
 */
import { formatCompact, formatPrice, formatScore } from "@/lib/leaderboard/format";
import type { PublicLeaderboardRow } from "@/lib/leaderboard/public";
import { SCATTER_FONT_PX, vendorColorMap, type ScatterGeometry } from "@/lib/leaderboard/scatter";

import { DeltaMark, EntityLink } from "./shared";

const AXIS_FILL = "var(--text-3)";
const GRID_STROKE = "var(--border)";

function PointLink({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}): React.ReactElement {
  if (url === "") return <g>{children}</g>;
  return (
    <a href={url} target="_blank" rel="nofollow noopener noreferrer">
      {children}
    </a>
  );
}

export function ModelScatter({
  geometry,
  rows,
  hasPrevious,
}: {
  geometry: ScatterGeometry;
  rows: PublicLeaderboardRow[];
  hasPrevious: boolean;
}): React.ReactElement {
  const g = geometry;
  const { left, top, right, bottom } = g.plot;
  const byKey = new Map(rows.map((r) => [r.entityKey, r]));
  const legend = [...vendorColorMap(rows).entries()];
  const xTitleY = g.height - 10;
  const yTitleX = 16;
  const yTitleY = (top + bottom) / 2;

  return (
    <div>
      {/* 桌面:散点 */}
      <div className="hidden sm:block">
        <svg
          viewBox={`0 0 ${g.width} ${g.height}`}
          className="h-auto w-full"
          role="img"
          aria-label="智能指数与输出价格的散点图,左上角为高分低价区"
        >
          {/* 坐标网格 */}
          {g.yTicks.map((t) => (
            <line
              key={`gy-${t.value}`}
              x1={left}
              x2={right}
              y1={t.pos}
              y2={t.pos}
              stroke={GRID_STROKE}
            />
          ))}
          {g.xTicks.map((t) => (
            <line
              key={`gx-${t.value}`}
              x1={t.pos}
              x2={t.pos}
              y1={top}
              y2={bottom}
              stroke={GRID_STROKE}
              strokeOpacity={0.5}
            />
          ))}

          {/* 左上象限底色 + 中位数十字 */}
          {g.guide !== null && (
            <>
              <rect
                x={left}
                y={top}
                width={g.guide.x - left}
                height={g.guide.y - top}
                fill="var(--accent-dim)"
                rx={4}
              />
              <line
                x1={g.guide.x}
                x2={g.guide.x}
                y1={top}
                y2={bottom}
                stroke={AXIS_FILL}
                strokeDasharray="3 4"
                strokeOpacity={0.55}
              />
              <line
                x1={left}
                x2={right}
                y1={g.guide.y}
                y2={g.guide.y}
                stroke={AXIS_FILL}
                strokeDasharray="3 4"
                strokeOpacity={0.55}
              />
            </>
          )}
          {g.quadLabel !== null && (
            <text x={g.quadLabel.x} y={g.quadLabel.y} fontSize={11} fill="var(--accent)">
              又强又便宜
            </text>
          )}

          {/* 刻度与轴题 */}
          {g.xTicks.map((t) => (
            <text
              key={`tx-${t.value}`}
              x={t.pos}
              y={bottom + 16}
              textAnchor="middle"
              fontSize={10}
              fill={AXIS_FILL}
            >
              {t.label}
            </text>
          ))}
          {g.yTicks.map((t) => (
            <text
              key={`ty-${t.value}`}
              x={left - 8}
              y={t.pos + 3}
              textAnchor="end"
              fontSize={10}
              fill={AXIS_FILL}
            >
              {t.label}
            </text>
          ))}
          <text
            x={(left + right) / 2}
            y={xTitleY}
            textAnchor="middle"
            fontSize={11}
            fill={AXIS_FILL}
          >
            输出价格(USD / 1M tokens · 对数轴)
          </text>
          <text
            transform={`translate(${yTitleX} ${yTitleY}) rotate(-90)`}
            textAnchor="middle"
            fontSize={11}
            fill={AXIS_FILL}
          >
            智能指数(AAII)
          </text>

          {/* 点(空心 = 开源权重) */}
          {g.points.map((p) => {
            const row = byKey.get(p.key);
            const ctx = formatCompact(row?.extra.contextWindowTokens);
            const tooltip = [
              p.name,
              p.vendor ?? "",
              `智能指数 ${formatScore(p.intelligence, null)}`,
              `输出价 ${formatPrice(p.price)} / 1M tokens`,
              ctx === "" ? "" : `上下文 ${ctx}`,
              p.hollow ? "开源权重" : "",
            ]
              .filter((s) => s !== "")
              .join(" · ");
            return (
              <PointLink key={p.key} url={row?.url ?? ""}>
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={4.5}
                  fill={p.hollow ? "none" : p.color}
                  stroke={p.color}
                  strokeWidth={p.hollow ? 2 : 1}
                >
                  <title>{tooltip}</title>
                </circle>
              </PointLink>
            );
          })}

          {/* 标注(避让后放不下的点不标;远距标注画引线指回自己的点) */}
          {g.labels.map((l) => (
            <g key={`lb-${l.text}-${l.x}-${l.y}`}>
              {l.leader !== null && (
                <line
                  x1={l.leader.x1}
                  y1={l.leader.y1}
                  x2={l.leader.x2}
                  y2={l.leader.y2}
                  stroke={AXIS_FILL}
                  strokeOpacity={0.4}
                  strokeWidth={0.9}
                  strokeDasharray="2 2"
                />
              )}
              <text
                x={l.x}
                y={l.y}
                textAnchor={l.anchor}
                fontSize={SCATTER_FONT_PX}
                fill="var(--text-2)"
              >
                {l.text}
              </text>
            </g>
          ))}
        </svg>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-3">
          {legend.map(([vendor, color]) => (
            <span key={vendor} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {vendor}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full border-2"
              style={{ borderColor: AXIS_FILL }}
            />
            空心 = 开源权重
          </span>
          {g.missingCount > 0 && <span>{g.missingCount} 个模型未公布输出价格,未绘入散点</span>}
        </div>
      </div>

      {/* 移动端:前 10 名列表替代散点 */}
      <ol className="mt-3 space-y-2 sm:hidden">
        {rows.slice(0, 10).map((row) => (
          <li key={row.entityKey} className="rounded-lg border border-line bg-panel px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 w-6 flex-none font-mono text-[12px] text-text-3">
                {row.rank}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug">
                  <EntityLink row={row} />
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-3">
                  <DeltaMark delta={row.delta} hasPrevious={hasPrevious} />
                  <span className="font-mono">
                    {formatScore(row.score, row.scoreUnit ?? "AAII")}
                  </span>
                  {row.extra.price1mOutputTokens !== undefined && (
                    <span className="font-mono text-amber">
                      {formatPrice(row.extra.price1mOutputTokens)} / 1M out
                    </span>
                  )}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
