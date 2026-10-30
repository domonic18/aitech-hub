"use client";

/**
 * F23 种子词库表体(板定 7 列 词语|来源|状态|关联|最近命中|添加于|操作):
 * 勾选列(全选本页)+ BatchActionBar 两动作(生效 active / 弃用 dismissed,
 * 三态可逆直发,与行内 StatusControl 同语义无确认步)。「关联」= 候选 N
 * (点词跳候选治理按词过滤)· 文章 N(published 标题命中);「最近命中」=
 * 候选批次时间(今天/昨天显相对,余显日期)。批量编排/勾选格/动作钮/状态徽
 * 走共享件;分页留 RSC 页。
 */
import Link from "next/link";

import StatusControl from "./StatusControl";
import BatchButton from "@/components/admin/batch/BatchButton";
import BatchActionBar from "@/components/admin/batch/BatchActionBar";
import { RowCheckbox, SelectAllTh } from "@/components/admin/batch/SelectionCheckbox";
import { useBatchAction } from "@/components/admin/batch/useBatchAction";
import { useBatchSelection } from "@/components/admin/batch/useBatchSelection";
import { DAY_MS, formatCnDate, formatCnTime } from "@/lib/datetime";
import type { KeywordAdminRow } from "@/lib/discovery/admin";
import type { KeywordYield } from "@/lib/discovery/word-yield";
import type { WordRelation } from "@/lib/discovery/word-relations";

/** 来源标签(板:手动|发现任务;hotword 来源标识悬停可见) */
function originLabel(k: KeywordAdminRow): string {
  return k.origin === "manual" ? "手动" : "发现任务";
}

/** 最近命中:今天/昨天 显「今天 HH:mm」,更早显 MM-DD(北京日界) */
function hitLabel(at: Date | null): string {
  if (at === null) return "—";
  const day = formatCnDate(at);
  const today = formatCnDate(new Date());
  if (day === today) return `今天 ${formatCnTime(at)}`;
  const yesterday = formatCnDate(new Date(Date.now() - DAY_MS));
  if (day === yesterday) return `昨天 ${formatCnTime(at)}`;
  return day.slice(5);
}

export default function KeywordTable({
  items,
  yieldByWord,
  relByWord,
}: {
  items: KeywordAdminRow[];
  /** 词→候选产出聚合(关联列候选计数;缺词=尚无候选命中,显 —) */
  yieldByWord: Record<string, KeywordYield>;
  /** 词→文章数与最近命中(页侧 unnest 一次聚合) */
  relByWord: Record<string, WordRelation>;
}): React.ReactElement {
  const rowIds = items.map((k) => k.id);
  const { selected, allSelected, toggle, toggleAll, clear } = useBatchSelection(rowIds);
  const { busy, msg, error, runBatch } = useBatchAction(clear);

  return (
    <>
      <BatchActionBar
        unit="个"
        count={selected.size}
        busy={busy}
        msg={msg}
        error={error}
        onCancel={clear}
      >
        <BatchButton
          variant="primary"
          label="批量生效"
          busyLabel="处理中…"
          busy={busy}
          disabled={busy || selected.size === 0}
          title="批量生效:加入发现轮取词,与行内「生效」同语义(记确认时间)"
          onClick={() =>
            runBatch({
              url: "/api/discovery/keywords/batch",
              body: { ids: [...selected], action: "activate" },
              donePrefix: "已生效",
            })
          }
        />
        <BatchButton
          variant="danger"
          label="批量弃用"
          busy={busy}
          disabled={busy || selected.size === 0}
          title="批量弃用:不参与发现轮,可再恢复"
          onClick={() =>
            runBatch({
              url: "/api/discovery/keywords/batch",
              body: { ids: [...selected], action: "dismiss" },
              donePrefix: "已弃用",
            })
          }
        />
      </BatchActionBar>

      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
            <SelectAllTh
              allSelected={allSelected}
              disabled={items.length === 0}
              onToggle={toggleAll}
            />
            <th className="px-4 py-2.5 font-medium">词语</th>
            <th className="px-3 py-2.5 font-medium">来源</th>
            <th className="px-3 py-2.5 font-medium">状态</th>
            <th className="px-3 py-2.5 font-medium" title="该词挖到的候选数与已产出文章数">
              关联
            </th>
            <th className="px-3 py-2.5 font-medium" title="该词最近一次命中候选的批次时间">
              最近命中
            </th>
            <th className="px-3 py-2.5 font-medium">添加于</th>
            <th className="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((k) => {
            const rel = relByWord[k.word];
            return (
              <tr key={k.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="px-3 py-2.5">
                  <RowCheckbox
                    label={`选择词「${k.word}」`}
                    checked={selected.has(k.id)}
                    onToggle={() => toggle(k.id)}
                  />
                </td>
                <td className="px-4 py-2.5 font-medium text-text-1">{k.word}</td>
                <td className="px-3 py-2.5 text-xs text-text-2" title={k.source ?? undefined}>
                  {originLabel(k)}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                  {(() => {
                    const y = yieldByWord[k.word];
                    if (!y) return <span className="text-text-3">—</span>;
                    return (
                      <Link
                        href={`/admin/insight/discovery/?t=candidates&kw=${encodeURIComponent(k.word)}`}
                        title={`查看该词挖到的候选(批准 ${y.approved})`}
                        className="hover:text-accent-hover hover:underline"
                      >
                        候选 {y.candidates}
                        {rel !== undefined && rel.posts > 0 && (
                          <span className="ml-1 text-green">· 文章 {rel.posts}</span>
                        )}
                      </Link>
                    );
                  })()}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                  {hitLabel(rel?.lastHitAt ?? null)}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                  {formatCnDate(k.firstSeenAt)}
                </td>
                <td className="px-4 py-2.5">
                  <StatusControl
                    endpoint="keywords"
                    id={k.id}
                    status={k.status}
                    name={`词「${k.word}」`}
                  />
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-xs text-text-3">
                暂无关键词,可在上方人工添加或到「发现任务」跑一轮发现
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
