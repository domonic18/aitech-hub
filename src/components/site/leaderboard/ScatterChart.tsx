/**
 * 榜单散点图(M63 v2,RSC 零交互):几何由 lib/leaderboard/scatter.ts 算好,
 * 本组件只把点/刻度/标签画成内联 SVG(DESIGN-SPEC §6 禁图表库)。模型能力与
 * Hugging Face 两节共用;轴题/提示语/移动端列表由调用方给。
 *
 * 悬停卡(M63 v2.3):每点自带 SVG 卡,显隐走 globals.css 的 `.lb-pt:hover` 纯 CSS,
 * 零 JS、SSR 直出;原生 <title> 退役(1s 延迟 + 系统样式,验收反馈「hover 没提示」)。
 * 卡片层画在点后、标签后,所以不会被网格或标注盖住;键盘聚焦同样出卡。
 *
 * 图例(M63 v2.3):列全部厂商 + 条数(前 5 家上色,其余灰点),让「榜上有没有
 * DeepSeek / Kimi」一眼可查——标注侧另有「每厂商至少一个代表」的预算保护。
 *
 * 双币刻度(M63 v2.1):主刻度与 xTicksAlt 各带 cur-cny / cur-usd 类,币种切换
 * 走 ModelBoard 的 radio + globals.css 的 :has() 规则(零 JS,两套刻度同进 HTML;
 * 对数轴下两币点位完全一致,只换刻度文本,见 scatter.test)。
 */
import type { PublicLeaderboardRow } from "@/lib/leaderboard/public";
import {
  SCATTER_FALLBACK_COLOR,
  SCATTER_FONT_PX,
  estimateTextWidth,
  vendorColorMap,
  vendorCounts,
  type ScatterDatum,
  type ScatterGeometry,
  type ScatterPoint,
  type ScatterTick,
} from "@/lib/leaderboard/scatter";

const AXIS_FILL = "var(--text-3)";
const GRID_STROKE = "var(--border)";

/** 悬停卡版式(与标注同字号口径,便于估算宽度) */
const TIP_LINE_H = 14;
const TIP_PAD_X = 7;
const TIP_PAD_Y = 6;

function PointLink({
  url,
  label,
  children,
}: {
  url: string;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  if (url === "") return <g>{children}</g>;
  return (
    <a href={url} target="_blank" rel="nofollow noopener noreferrer" aria-label={label}>
      {children}
    </a>
  );
}

/** 悬停卡:贴着点放,越界自动翻到反侧/夹回绘图区,不出画布 */
function PointTip({
  lines,
  cx,
  cy,
  plot,
}: {
  lines: string[];
  cx: number;
  cy: number;
  plot: ScatterGeometry["plot"];
}): React.ReactElement {
  const w = Math.max(...lines.map(estimateTextWidth)) + TIP_PAD_X * 2;
  const h = lines.length * TIP_LINE_H + TIP_PAD_Y * 2 - 4;
  const maxW = plot.right - plot.left - 8;
  const width = Math.min(w, maxW);
  let x = cx + 10;
  if (x + width > plot.right - 2) x = cx - 10 - width;
  x = Math.min(Math.max(x, plot.left + 2), plot.right - 2 - width);
  let y = cy - 8 - h;
  if (y < plot.top + 2) y = cy + 10;
  y = Math.min(Math.max(y, plot.top + 2), plot.bottom - h - 2);
  return (
    <g className="lb-tip" pointerEvents="none">
      <rect
        x={x}
        y={y}
        width={width}
        height={h}
        rx={4}
        fill="var(--panel)"
        stroke="var(--border)"
      />
      {lines.map((text, i) => (
        <text
          key={text}
          x={x + TIP_PAD_X}
          y={y + TIP_PAD_Y + TIP_LINE_H * i + 4}
          fontSize={SCATTER_FONT_PX}
          fill={i === 0 ? "var(--text-1)" : "var(--text-2)"}
        >
          {text}
        </text>
      ))}
    </g>
  );
}

export function ScatterChart({
  geometry,
  data,
  rows,
  ariaLabel,
  xTitle,
  yTitle,
  quadLabel,
  tooltip,
  legendNote,
  missingNote,
  mobile,
  xTicksAlt,
}: {
  geometry: ScatterGeometry;
  /** 与几何同源的输入(图例配色按此统计,保证与点色一致) */
  data: ScatterDatum[];
  rows: PublicLeaderboardRow[];
  ariaLabel: string;
  xTitle: string;
  yTitle: string;
  /** 左上象限的高亮注记(如「又强又便宜」) */
  quadLabel: string;
  tooltip: (row: PublicLeaderboardRow | undefined, point: ScatterPoint) => string[];
  /** 图例附加说明(如「空心 = 开源权重」);null 不渲染 */
  legendNote?: string;
  /** 未绘入条数说明;null 不渲染 */
  missingNote?: string | null;
  mobile: React.ReactNode;
  /** 备选币种的 x 刻度(位置与主刻度同域,只换刻度文本);缺省不出第二套 */
  xTicksAlt?: ScatterTick[];
}): React.ReactElement {
  const g = geometry;
  const { left, top, right, bottom } = g.plot;
  const byKey = new Map(rows.map((r) => [r.entityKey, r]));
  const colors = vendorColorMap(data);
  const vendors = vendorCounts(data);
  const hasGrey = vendors.some((v) => !colors.has(v.vendor));
  const xTitleY = g.height - 10;
  const yTitleX = 16;
  const yTitleY = (top + bottom) / 2;

  return (
    <div>
      {/* 桌面:散点 */}
      <div className="hidden sm:block">
        <svg
          viewBox={`0 0 ${String(g.width)} ${String(g.height)}`}
          className="h-auto w-full"
          role="img"
          aria-label={ariaLabel}
        >
          {/* 坐标网格 */}
          {g.yTicks.map((t) => (
            <line
              key={`gy-${String(t.value)}`}
              x1={left}
              x2={right}
              y1={t.pos}
              y2={t.pos}
              stroke={GRID_STROKE}
            />
          ))}
          {g.xTicks.map((t) => (
            <line
              key={`gx-${String(t.value)}`}
              x1={t.pos}
              x2={t.pos}
              y1={top}
              y2={bottom}
              stroke={GRID_STROKE}
              strokeOpacity={0.5}
              className="cur-cny"
            />
          ))}
          {(xTicksAlt ?? []).map((t) => (
            <line
              key={`gxa-${String(t.value)}`}
              x1={t.pos}
              x2={t.pos}
              y1={top}
              y2={bottom}
              stroke={GRID_STROKE}
              strokeOpacity={0.5}
              className="cur-usd"
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
              {quadLabel}
            </text>
          )}

          {/* 刻度与轴题 */}
          {g.xTicks.map((t) => (
            <text
              key={`tx-${String(t.value)}`}
              x={t.pos}
              y={bottom + 16}
              textAnchor="middle"
              fontSize={10}
              fill={AXIS_FILL}
              className="cur-cny"
            >
              {t.label}
            </text>
          ))}
          {(xTicksAlt ?? []).map((t) => (
            <text
              key={`txa-${String(t.value)}`}
              x={t.pos}
              y={bottom + 16}
              textAnchor="middle"
              fontSize={10}
              fill={AXIS_FILL}
              className="cur-usd"
            >
              {t.label}
            </text>
          ))}
          {g.yTicks.map((t) => (
            <text
              key={`ty-${String(t.value)}`}
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
            {xTitle}
          </text>
          <text
            transform={`translate(${String(yTitleX)} ${String(yTitleY)}) rotate(-90)`}
            textAnchor="middle"
            fontSize={11}
            fill={AXIS_FILL}
          >
            {yTitle}
          </text>

          {/* 标注(避让后放不下的点不标;远距标注画引线指回自己的点)。
              画在点之前,点的悬停卡才能压在最上层 */}
          {g.labels.map((l) => (
            <g key={`lb-${l.text}-${String(l.x)}-${String(l.y)}`}>
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

          {/* 点(空心 = 语义由调用方声明)+ 每点悬停卡 */}
          {g.points.map((p) => {
            const row = byKey.get(p.key);
            const lines = tooltip(row, p).filter((s) => s !== "");
            return (
              <g className="lb-pt" key={p.key}>
                <PointLink url={row?.url ?? ""} label={lines.join(", ")}>
                  <circle
                    className="lb-dot"
                    cx={p.cx}
                    cy={p.cy}
                    r={4.5}
                    fill={p.hollow ? "none" : p.color}
                    stroke={p.color}
                    strokeWidth={p.hollow ? 2 : 1}
                  />
                  {/* 透明描边 = 命中区外扩 2px,小点也好悬停 */}
                  <circle
                    cx={p.cx}
                    cy={p.cy}
                    r={4.5}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth={4}
                  />
                </PointLink>
                {lines.length > 0 && <PointTip lines={lines} cx={p.cx} cy={p.cy} plot={g.plot} />}
              </g>
            );
          })}
        </svg>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-3">
          {vendors.map(({ vendor, count }) => (
            <span key={vendor} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: colors.get(vendor) ?? SCATTER_FALLBACK_COLOR }}
              />
              {vendor}
              <span className="font-mono text-[10px]">{count}</span>
            </span>
          ))}
          {hasGrey && <span>灰 = 其余厂商</span>}
          {legendNote !== undefined && legendNote !== "" && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full border-2"
                style={{ borderColor: AXIS_FILL }}
              />
              {legendNote}
            </span>
          )}
          {missingNote !== undefined && missingNote !== null && missingNote !== "" && (
            <span>{missingNote}</span>
          )}
        </div>
      </div>

      {mobile}
    </div>
  );
}
