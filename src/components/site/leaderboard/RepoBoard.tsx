/**
 * 热门仓库动量卡(M63):高亮条(今日上升最快 / 新入榜)+ 卡片栅格。
 * 首期采集(无上一可用日期)时不出「新入榜」、上升榜降级为「今日新增星标」,
 * 避免整榜被误标为新入榜。描述/语言/总星/分叉缺则整项省略。
 */
import { formatCompact } from "@/lib/leaderboard/format";
import type { PublicLeaderboard, PublicLeaderboardRow } from "@/lib/leaderboard/public";

import { BoardFrame } from "./BoardFrame";
import { Chip, DeltaMark } from "./shared";

function splitRepo(row: PublicLeaderboardRow): { owner: string; repo: string } {
  const key = row.entityName === "" ? row.entityKey : row.entityName;
  const at = key.indexOf("/");
  return at < 0 ? { owner: "", repo: key } : { owner: key.slice(0, at), repo: key.slice(at + 1) };
}

function RepoName({ row }: { row: PublicLeaderboardRow }): React.ReactElement {
  const { owner, repo } = splitRepo(row);
  const body = (
    <>
      {owner !== "" && <span className="text-text-3">{owner}/</span>}
      {repo}
    </>
  );
  if (row.url === "") return <span className="text-[13px] text-text-1">{body}</span>;
  return (
    <a
      href={row.url}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="text-[13px] text-text-1 hover:text-accent-hover"
    >
      {body}
    </a>
  );
}

/** 高亮条单元:名次 + 仓库 + 指标 */
function HighlightRow({
  row,
  metric,
}: {
  row: PublicLeaderboardRow;
  metric: React.ReactNode;
}): React.ReactElement {
  return (
    <li className="flex items-baseline gap-2">
      <span className="w-4 flex-none font-mono text-[11px] text-text-3">{row.rank}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px]">
        <RepoName row={row} />
      </span>
      <span className="flex-none font-mono text-[11px]">{metric}</span>
    </li>
  );
}

export function RepoBoard({ board }: { board: PublicLeaderboard }): React.ReactElement {
  const { rows, hasPrevious } = board;
  const rising = hasPrevious
    ? rows
        .filter((r) => r.delta !== null && r.delta > 0)
        .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0) || (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 3)
    : [...rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);
  const newcomers = hasPrevious ? rows.filter((r) => r.delta === null).slice(0, 3) : [];

  return (
    <BoardFrame
      id="repos"
      title="热门仓库"
      hint="GitHub Trending 日榜;星标为当日新增,名次变动与昨日日榜比较。"
      capturedDate={board.capturedDate}
      staleDays={board.staleDays}
      sources={[{ label: board.label, url: board.sourceUrl }]}
    >
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-accent/30 bg-accent-dim p-3">
          <p className="text-[11px] font-semibold text-accent">
            {hasPrevious ? "今日上升最快" : "今日新增星标最多"}
          </p>
          <ol className="mt-2 space-y-1.5">
            {rising.length === 0 ? (
              <li className="text-[11px] text-text-3">本期无名次上升的仓库。</li>
            ) : (
              rising.map((row) => (
                <HighlightRow
                  key={row.entityKey}
                  row={row}
                  metric={
                    hasPrevious ? (
                      <DeltaMark delta={row.delta} />
                    ) : (
                      <span className="text-amber">+{formatCompact(row.score)} 今日</span>
                    )
                  }
                />
              ))
            )}
          </ol>
        </div>
        <div className="rounded-lg border border-green/30 bg-green/10 p-3">
          <p className="text-[11px] font-semibold text-green">新入榜</p>
          <ol className="mt-2 space-y-1.5">
            {newcomers.length === 0 ? (
              <li className="text-[11px] text-text-3">
                {hasPrevious ? "本期无新入榜仓库。" : "首期采集,暂无环比。"}
              </li>
            ) : (
              newcomers.map((row) => (
                <HighlightRow
                  key={row.entityKey}
                  row={row}
                  metric={<span className="text-amber">+{formatCompact(row.score)} 今日</span>}
                />
              ))
            )}
          </ol>
        </div>
      </div>

      <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const { extra } = row;
          const stars = formatCompact(extra.stars);
          const forks = formatCompact(extra.forks);
          return (
            <li
              key={row.entityKey}
              className="rounded-lg border border-line bg-panel p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="mr-1 font-mono text-[11px] text-text-3">{row.rank}</span>
                  <RepoName row={row} />
                </span>
                <DeltaMark delta={row.delta} hasPrevious={hasPrevious} />
              </div>
              {extra.description !== undefined && (
                <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-text-2">
                  {extra.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {extra.language !== undefined && <Chip>{extra.language}</Chip>}
                {stars !== "" && <Chip>星 {stars}</Chip>}
                {forks !== "" && <Chip>分叉 {forks}</Chip>}
                {row.score !== null && <Chip tone="amber">+{formatCompact(row.score)} 今日</Chip>}
              </div>
            </li>
          );
        })}
      </ol>
    </BoardFrame>
  );
}
