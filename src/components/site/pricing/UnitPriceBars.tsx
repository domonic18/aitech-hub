"use client";

/**
 * 单价横向条形图(M74 批G):文生图/文生视频等**非 token 计价**模型的生成价对比,
 * 零 JS SVG(手写、禁图表库,同 PriceScatter 纪律;hover 卡用 CSS 驱动)。
 *
 * 每条 = 一个模型**最便宜的一家**生成价;按 币种×单位 分块(元/张与元/秒
 * 量纲不同各自成块,原币直出不折算);条长按组内最大价线性归一。
 * 完全免费(0 价)条长无从比较 → 不入图,在图下说明数量。
 */
import {
  buildUnitPriceBars,
  UNIT_BARS_LABEL_W,
  UNIT_BARS_MAX_ROWS,
  UNIT_BARS_ROW_H,
  unitBarsCanvasWidth,
} from "@/lib/pricing/bars";
import { formatPrice, type PublicModelRow } from "@/lib/pricing/public";

export function UnitPriceBars({ rows }: { rows: PublicModelRow[] }): React.ReactElement {
  const groups = buildUnitPriceBars(rows);

  if (groups.length === 0) {
    return <></>;
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-3">
      {groups.map((g) => {
        const labelLeft = UNIT_BARS_LABEL_W;
        const height = g.bars.length * UNIT_BARS_ROW_H + 18;
        // 画布宽 = 标签区 + 最大条长 + 价格标注区(条与价格文本都落在画布内)
        const width = unitBarsCanvasWidth();
        return (
          <div key={`${g.currency}|${g.priceUnit}`}>
            <p className="mb-1.5 text-[11.5px] text-text-3">
              {g.currency === "USD" ? "$" : "¥"}
              {g.unitSuffix} · {g.bars.length} 个模型
            </p>
            <div className="overflow-x-auto">
              <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full min-w-[560px]"
                role="img"
                aria-label={`生成价条形图(${g.currency} ${g.unitSuffix})`}
              >
                {g.bars.map((b, i) => {
                  const y = i * UNIT_BARS_ROW_H + 6;
                  const barX = labelLeft;
                  return (
                    <g key={b.id} className="pc-pt">
                      <text
                        x={labelLeft - 8}
                        y={y + 13}
                        textAnchor="end"
                        fontSize="11"
                        fill="var(--text-2)"
                      >
                        {b.displayName.length > 30
                          ? `${b.displayName.slice(0, 29)}…`
                          : b.displayName}
                      </text>
                      <rect
                        x={barX}
                        y={y + 3}
                        width={b.width}
                        height={16}
                        rx="3"
                        fill="var(--accent)"
                        fillOpacity="0.55"
                        className="pc-dot"
                      />
                      <text x={barX + b.width + 8} y={y + 15} fontSize="10.5" fill="var(--text-3)">
                        {formatPrice(b.price, g.currency, g.priceUnit)}
                      </text>
                      <g className="pc-tip">
                        <rect
                          x={Math.min(barX + 16, width - 200)}
                          y={y - 4}
                          width="192"
                          height="34"
                          rx="4"
                          fill="var(--panel-2)"
                          stroke="var(--border)"
                        />
                        <text
                          x={Math.min(barX + 24, width - 192)}
                          y={y + 9}
                          fontSize="11"
                          fill="var(--text-1)"
                        >
                          {b.displayName.slice(0, 22)}
                        </text>
                        <text
                          x={Math.min(barX + 24, width - 192)}
                          y={y + 23}
                          fontSize="10"
                          fill="var(--text-3)"
                        >
                          {b.providerName.slice(0, 14)} · 最低{" "}
                          {formatPrice(b.price, g.currency, g.priceUnit)}
                        </text>
                      </g>
                    </g>
                  );
                })}
              </svg>
            </div>
            {g.skipped > 0 && (
              <p className="mt-1 text-[10.5px] text-amber">
                {g.skipped} 个模型为 0 价(完全免费),未入图
              </p>
            )}
          </div>
        );
      })}
      {groups.some((g) => g.bars.length >= UNIT_BARS_MAX_ROWS) && (
        <p className="text-[10.5px] text-text-3">
          每块最多展示 {UNIT_BARS_MAX_ROWS} 条(按价升序,更贵的从略)
        </p>
      )}
    </div>
  );
}
