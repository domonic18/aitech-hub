/**
 * Hugging Face 模型趋势横条(M63):条长 = trendingScore 相对最高分比例。
 * 条是装饰(aria-hidden),数值文字承载全部信息;下载/赞数量有才出副行。
 */
import { formatCompact, formatScore } from "@/lib/leaderboard/format";
import type { PublicLeaderboardRow } from "@/lib/leaderboard/public";

import { DeltaMark, EntityLink } from "./shared";

export function TrendingBars({
  rows,
  hasPrevious,
}: {
  rows: PublicLeaderboardRow[];
  hasPrevious: boolean;
}): React.ReactElement {
  const max = Math.max(0, ...rows.map((r) => r.score ?? 0));

  return (
    <ol className="mt-3 space-y-2">
      {rows.map((row) => {
        const pct =
          max > 0 && row.score !== null ? Math.max(2, Math.round((row.score / max) * 100)) : 0;
        const downloads = formatCompact(row.extra.downloads);
        const likes = formatCompact(row.extra.likes);
        return (
          <li key={row.entityKey} className="flex items-center gap-2.5">
            <span className="w-5 flex-none text-right font-mono text-[11px] text-text-3">
              {row.rank}
            </span>
            <span className="w-36 flex-none sm:w-52">
              <span className="block truncate text-[12.5px]">
                <EntityLink row={row} />
              </span>
              {(downloads !== "" || likes !== "") && (
                <span className="block truncate font-mono text-[10.5px] text-text-3">
                  {downloads !== "" && `下载 ${downloads}`}
                  {downloads !== "" && likes !== "" && " · "}
                  {likes !== "" && `赞 ${likes}`}
                </span>
              )}
            </span>
            <span aria-hidden="true" className="h-2 min-w-0 flex-1 rounded-sm bg-panel-2">
              <span
                className="block h-2 rounded-sm bg-accent"
                style={{ width: `${String(pct)}%` }}
              />
            </span>
            <span className="w-20 flex-none text-right font-mono text-[11px] text-text-2">
              {formatScore(row.score, null)}
            </span>
            <span className="hidden w-10 flex-none sm:block">
              <DeltaMark delta={row.delta} hasPrevious={hasPrevious} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
