/**
 * 今日热榜面板(M34 批③ 渠道视图;验收反馈·主流热榜样式):每源一卡,头部名次
 * 三色(1 红/2 橙/3 黄)+名次变动(↑n/↓n/新)+热度比例条,对比上一拉取批。
 * 纯展示零状态,数据来自 lib/insight/hotboard#hotBoardForDay(缺省最新批,
 * 可传日期回看);复用 shared。
 */
import Link from "next/link";

import type { InsightHotItem, InsightHotSourceBoard } from "@/lib/insight/hotboard";

import { formatTime, SOURCE_LABELS } from "./shared";

/** 热度口径各站不同,只做千分位/万位缩写展示(不跨源可比) */
function formatHeat(heat: number): string {
  if (heat >= 10_000) {
    const w = heat / 10_000;
    return `${w >= 100 ? Math.round(w) : w.toFixed(1)}万`;
  }
  return heat.toLocaleString();
}

/** 头部名次三色(主流热榜口径) */
function rankClass(rank: number): string {
  if (rank === 1) return "font-semibold text-red";
  if (rank === 2) return "font-semibold text-amber-hi";
  if (rank === 3) return "font-semibold text-amber";
  return "text-text-3";
}

/** 名次变动:↑n 绿 / ↓n 红 / — 持平 / 新 红徽 */
function MoveMark({ move }: { move: number | null }): React.ReactElement {
  if (move === null) {
    return (
      <span
        className="w-7 shrink-0 rounded-sm bg-red/12 px-1 text-center font-mono text-[10px] leading-4 text-red"
        title="新上榜(上一批未在榜)"
      >
        新
      </span>
    );
  }
  if (move === 0) {
    return (
      <span className="w-7 shrink-0 text-center font-mono text-[10px] text-text-3" title="名次持平">
        —
      </span>
    );
  }
  const up = move > 0;
  return (
    <span
      className={`w-7 shrink-0 text-center font-mono text-[10px] ${up ? "text-green" : "text-red"}`}
      title={up ? `较上一批上升 ${move} 位` : `较上一批下降 ${-move} 位`}
    >
      {up ? "↑" : "↓"}
      {Math.abs(move)}
    </span>
  );
}

function ItemRow({ it, maxHeat }: { it: InsightHotItem; maxHeat: number }): React.ReactElement {
  return (
    <li className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 hover:bg-panel-2">
      <span className={`w-5 shrink-0 text-right font-mono text-[12px] ${rankClass(it.rank)}`}>
        {it.rank}
      </span>
      <MoveMark move={it.move} />
      {it.url !== null ? (
        <a
          href={it.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 shrink line-clamp-1 text-[13px] text-text-1 hover:text-accent"
          title={it.title}
        >
          {it.title}
        </a>
      ) : (
        <span className="min-w-0 shrink line-clamp-1 text-[13px] text-text-1" title={it.title}>
          {it.title}
        </span>
      )}
      {it.heat !== null && maxHeat > 0 ? (
        <span className="hidden h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-panel-2 sm:block">
          <span
            className="block h-full rounded-full bg-accent opacity-70"
            style={{ width: `${Math.max(4, (it.heat / maxHeat) * 100)}%` }}
          />
        </span>
      ) : (
        <span className="flex-1" />
      )}
      <span className="shrink-0 font-mono text-[10px] text-text-3">
        {it.heat !== null ? formatHeat(it.heat) : ""}
      </span>
    </li>
  );
}

function BoardCard({ board }: { board: InsightHotSourceBoard }): React.ReactElement {
  const maxHeat = Math.max(...board.items.map((it) => it.heat ?? 0), 0);
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
          <ItemRow key={it.rank} it={it} maxHeat={maxHeat} />
        ))}
        {board.items.length === 0 && (
          <li className="px-2 py-6 text-center text-xs text-text-3">
            暂无榜面:等每日拉取(07:43)——去
            <Link href="/admin/data/sources/?t=hot" className="mx-0.5 text-accent hover:underline">
              源管理·热榜源
            </Link>
            确认启停,或
            <Link href="/admin/data/run/?t=plan" className="mx-0.5 text-accent hover:underline">
              运行·计划
            </Link>
            看排程
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
