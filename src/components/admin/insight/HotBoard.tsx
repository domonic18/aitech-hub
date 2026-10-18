/**
 * 今日热榜面板(M34 批③ 渠道视图):每个外部热榜源一张卡,展示最新拉取批的
 * 榜面(位次/热度/原文外链,新窗口打开)。纯展示零状态,数据来自
 * lib/insight/hotboard#latestHotBoard;源标签/时间格式化复用 shared。
 */
import type { InsightHotSourceBoard } from "@/lib/insight/hotboard";

import { formatTime, SOURCE_LABELS } from "./shared";

/** 热度口径各站不同,只做千分位/万位缩写展示(不跨源可比) */
function formatHeat(heat: number): string {
  if (heat >= 10_000) {
    const w = heat / 10_000;
    return `${w >= 100 ? Math.round(w) : w.toFixed(1)}万`;
  }
  return heat.toLocaleString();
}

function BoardCard({ board }: { board: InsightHotSourceBoard }): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex items-baseline justify-between border-b border-line bg-panel-2 px-4 py-2.5">
        <span className="text-xs font-semibold text-text-1">
          {SOURCE_LABELS[board.source] ?? board.source}
        </span>
        <span className="font-mono text-[10px] text-text-3">
          {board.fetchedAt === null ? "暂无拉取" : `更新 ${formatTime(board.fetchedAt)}`}
        </span>
      </div>
      <ol className="px-2 py-1">
        {board.items.slice(0, 15).map((it) => (
          <li
            key={it.rank}
            className="flex items-baseline gap-2 rounded-sm px-2 py-1.5 hover:bg-panel-2"
          >
            <span
              className={`w-5 shrink-0 text-right font-mono text-[11px] ${
                it.rank <= 3 ? "font-semibold text-accent" : "text-text-3"
              }`}
            >
              {it.rank}
            </span>
            {it.url !== null ? (
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer"
                className="line-clamp-1 text-[13px] text-text-1 hover:text-accent"
                title={it.title}
              >
                {it.title}
              </a>
            ) : (
              <span className="line-clamp-1 text-[13px] text-text-1" title={it.title}>
                {it.title}
              </span>
            )}
            {it.heat !== null && (
              <span className="ml-auto shrink-0 font-mono text-[10px] text-text-3">
                {formatHeat(it.heat)}
              </span>
            )}
          </li>
        ))}
        {board.items.length === 0 && (
          <li className="px-2 py-6 text-center text-xs text-text-3">
            暂无榜面:等每日拉取(07:43)或 insight:run -- fetch 手动补跑
          </li>
        )}
      </ol>
    </div>
  );
}

export default function HotBoard({
  boards,
}: {
  boards: InsightHotSourceBoard[];
}): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {boards.map((b) => (
        <BoardCard key={b.source} board={b} />
      ))}
    </div>
  );
}
