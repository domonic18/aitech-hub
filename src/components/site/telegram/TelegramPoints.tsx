"use client";

/**
 * 电报流「关键要点 ×N」折叠块(P2-14a 自 code-review-20261029 收敛:
 * TelegramTimeline 文字卡 / TelegramArticle 视频卡的 inline 变体逐字同构;
 * TelegramBandRows 的 BandPoints 为首页带 band 变体——默认展开 + 行网格列对齐 +
 * chevron 富 summary,由 BandPoints 外壳套 ROW_GRID 网格后使用):
 * 渲染产物(HTML 结构/类名)与抽取前三处逐字一致;points 为空返回 null。
 */
/** inline=电报流卡内轻折叠(摘要下方 2px);band=首页 LIVE 带富折叠(默认展开) */
export function TelegramPoints({
  points,
  variant = "inline",
}: {
  points: readonly string[];
  variant?: "inline" | "band";
}): React.ReactElement | null {
  if (points.length === 0) return null;
  if (variant === "band") {
    return (
      <details open className="group col-start-2 sm:col-start-3">
        <summary className="-mx-1.5 flex cursor-pointer list-none items-center gap-1.5 rounded-sm px-1.5 py-1 text-[11px] text-text-3 transition-colors hover:bg-panel hover:text-text-1 [&::-webkit-details-marker]:hidden">
          <svg
            className="ic ic-sm flex-none text-text-3 transition-transform duration-200 group-open:rotate-90"
            aria-hidden="true"
          >
            <use href="#i-caret-right-fill" />
          </svg>
          <span className="font-medium">关键要点</span>
          <span className="rounded-full bg-panel-2 px-1.5 font-mono text-[10px] leading-4">
            ×{points.length}
          </span>
        </summary>
        <PointsList points={points} />
      </details>
    );
  }
  return (
    <details className="mt-0.5">
      <summary className="cursor-pointer font-mono text-[11px] text-text-3 hover:text-accent-hover">
        关键要点 ×{points.length}
      </summary>
      <PointsList points={points} />
    </details>
  );
}

/** 要点列表(两变体共用同一 ul 口径) */
function PointsList({ points }: { points: readonly string[] }): React.ReactElement {
  return (
    <ul className="mt-1 list-disc pl-5 text-[12px] leading-relaxed text-text-2">
      {points.map((p, i) => (
        <li key={i}>{p}</li>
      ))}
    </ul>
  );
}
