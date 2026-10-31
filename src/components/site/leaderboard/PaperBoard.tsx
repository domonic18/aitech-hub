/**
 * 论文卡片流(M63):arXiv cs.AI / cs.CL 两个子组,各 20 张卡。
 * 标题/作者/提交日/分类/摘要——字段缺(存量行无 meta)整项省略,绝不空标签;
 * 全组都缺摘要时子组底部给一句补采说明。
 */
import { formatAuthors } from "@/lib/leaderboard/format";
import type { PublicLeaderboard, PublicLeaderboardRow } from "@/lib/leaderboard/public";

import { BoardFrame } from "./BoardFrame";
import { Chip } from "./shared";

function PaperCard({ row }: { row: PublicLeaderboardRow }): React.ReactElement {
  const { extra } = row;
  const authors = formatAuthors(extra.authors);
  const categories = extra.categories ?? [];
  const label = row.entityName === "" ? row.entityKey : row.entityName;
  return (
    <li className="rounded-lg border border-line bg-panel p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 w-5 flex-none font-mono text-[11px] text-text-3">{row.rank}</span>
        <div className="min-w-0 flex-1">
          {row.url === "" ? (
            <span className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-text-1">
              {label}
            </span>
          ) : (
            <a
              href={row.url}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-text-1 hover:text-accent-hover"
            >
              {label}
            </a>
          )}
          {authors !== "" && <p className="mt-1 line-clamp-1 text-[11px] text-text-3">{authors}</p>}
          {(extra.publishedAt !== undefined || categories.length > 0) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {extra.publishedAt !== undefined && (
                <span className="font-mono text-[11px] text-text-3">{extra.publishedAt}</span>
              )}
              {categories.slice(0, 3).map((c) => (
                <Chip key={c}>{c}</Chip>
              ))}
              {categories.length > 3 && <Chip>+{categories.length - 3}</Chip>}
            </p>
          )}
          {extra.summary !== undefined && (
            <p className="mt-2 line-clamp-3 text-[12px] leading-relaxed text-text-2">
              {extra.summary}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export function PaperBoard({ boards }: { boards: PublicLeaderboard[] }): React.ReactElement | null {
  if (boards.length === 0) return null;
  const capturedDate = boards.reduce<string | null>(
    (acc, b) => (acc === null || b.capturedDate > acc ? b.capturedDate : acc),
    null,
  );
  const staleDays = Math.max(0, ...boards.map((b) => b.staleDays));

  return (
    <BoardFrame
      id="papers"
      title="论文"
      hint="arXiv 最新提交,按提交时间倒序;标题与摘要来自作者原文,未做改写。"
      capturedDate={capturedDate}
      staleDays={staleDays}
      sources={boards.map((b) => ({ label: b.label, url: b.sourceUrl }))}
    >
      <div className="mt-4 space-y-6">
        {boards.map((board) => {
          const allMissing = board.rows.every((r) => r.extra.summary === undefined);
          return (
            <div key={board.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-text-2">{board.board}</h3>
                <span className="font-mono text-[11px] text-text-3">{board.rows.length} 篇</span>
              </div>
              <ol className="mt-2 grid gap-3 sm:grid-cols-2">
                {board.rows.map((row) => (
                  <PaperCard key={row.entityKey} row={row} />
                ))}
              </ol>
              {allMissing && (
                <p className="mt-2 text-[11px] text-text-3">
                  本期摘要待补采,下次采集后展示作者与摘要。
                </p>
              )}
            </div>
          );
        })}
      </div>
    </BoardFrame>
  );
}
