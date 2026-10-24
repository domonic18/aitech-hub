"use client";

/**
 * 热榜信号·渠道合并榜(M46 验收批,F11 v2 对齐设计稿;替代分源三列栅格):
 * 各源 Top N 交织成单列全宽榜(按原生位次升序,同位次热度降序),行=名次三色
 * +标题(不截断挤压,hover 展开)+来源 chip(多源时)+热度右对齐+名次变动;
 * footer 共 N 条 · 每渠道 Top 15 · 展开/收起。位次/热度为各站原生口径不跨源
 * 可比——合并序只作浏览便利,行内保留原生位次。数据来自 lib/insight/hotboard
 * #hotBoardForDay(缺省最新批,可传日期回看;源筛选由页侧 hs 参数完成,单源
 * 时本件自动隐藏来源 chip)。
 */
import Link from "next/link";
import { useState } from "react";

import { HOTLIST_MAX_ITEMS } from "@/lib/insight/constants";
import type { InsightHotItem, InsightHotSourceBoard } from "@/lib/insight/hotboard";

import { shortSource } from "./shared";

/** 每渠道展示条数:默认 15,展开=上游截断上限(与 ingest HOTLIST_MAX_ITEMS 同源) */
const LIMIT_DEFAULT = 15;
const LIMIT_EXPANDED = HOTLIST_MAX_ITEMS;

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

/** 合并行:原生位次 + 标题(flex 撑满,断行截断有 title 兜底)+来源+热度+变动 */
function MergedRow({
  it,
  source,
  showSource,
}: {
  it: InsightHotItem;
  source: string;
  showSource: boolean;
}): React.ReactElement {
  return (
    <li className="flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-panel-2">
      <span className={`w-5 shrink-0 text-right font-mono text-[12px] ${rankClass(it.rank)}`}>
        {it.rank}
      </span>
      {it.url !== null ? (
        <a
          href={it.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate text-[13px] text-text-1 hover:text-accent"
          title={it.title}
        >
          {it.title}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13px] text-text-1" title={it.title}>
          {it.title}
        </span>
      )}
      {showSource && (
        <span className="w-9 shrink-0 truncate text-[10px] text-text-3" title={shortSource(source)}>
          {shortSource(source)}
        </span>
      )}
      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-text-2">
        {it.heat !== null ? formatHeat(it.heat) : ""}
      </span>
      <MoveMark move={it.move} />
    </li>
  );
}

export default function HotBoard({
  boards,
}: {
  boards: InsightHotSourceBoard[];
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? LIMIT_EXPANDED : LIMIT_DEFAULT;
  const showSource = boards.length > 1;

  const perBoard = boards.map((b) => ({ source: b.source, items: b.items.slice(0, limit) }));
  /** 交织合并:位次升序(各源 rank 1,1,1,2,2,2…),同位次热度降序,余者保持源序 */
  const merged = perBoard
    .flatMap(({ source, items }) => items.map((it) => ({ it, source })))
    .sort((a, b) => a.it.rank - b.it.rank || (b.it.heat ?? -Infinity) - (a.it.heat ?? -Infinity));
  const totalShown = merged.length;
  /** 可展开判定:任一源在展开档还有更多条 */
  const canExpand = boards.some((b) => b.items.length > LIMIT_DEFAULT);

  if (totalShown === 0) {
    return (
      <div className="px-2 py-6 text-center text-xs text-text-3">
        暂无榜面:等每日拉取(07:43)——去
        <Link href="/admin/data/sources/?t=channels" className="mx-0.5 text-accent hover:underline">
          源管理·热榜源
        </Link>
        确认启停,或
        <Link href="/admin/data/plan/" className="mx-0.5 text-accent hover:underline">
          运行·计划
        </Link>
        看排程
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <ol className="px-0 py-0">
        {merged.map(({ it, source }) => (
          <MergedRow
            key={`${source}-${it.rank}-${it.title}`}
            it={it}
            source={source}
            showSource={showSource}
          />
        ))}
      </ol>
      <div className="mt-1 flex items-center justify-end gap-2 border-t border-line px-2 pt-2 text-[11px]">
        <span className="text-text-3">
          共 {totalShown} 条 · {showSource ? "每渠道 " : ""}Top {limit}
        </span>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="font-medium text-accent hover:underline"
          >
            {expanded ? "收起 Top 15 ▴" : "展开 Top 50 ▾"}
          </button>
        )}
      </div>
    </div>
  );
}
