"use client";

/**
 * 词库管理表体(M31 验收反馈:多选批量生效/弃用;自 RSC 页抽出):勾选列
 * (全选本页)+ BatchActionBar 两动作(生效 active / 弃用 dismissed,三态
 * 可逆直发,与行内 StatusControl 同语义无确认步)。行内 StatusControl 原样。
 * 批量编排/勾选格/动作钮/状态徽走共享件(技术债批②)。候选表不在本件范围;
 * 分页留 RSC 页。
 */
import Link from "next/link";

import StatusControl from "./StatusControl";
import BatchButton from "@/components/admin/batch/BatchButton";
import BatchActionBar from "@/components/admin/batch/BatchActionBar";
import { RowCheckbox, SelectAllTh } from "@/components/admin/batch/SelectionCheckbox";
import { useBatchAction } from "@/components/admin/batch/useBatchAction";
import { useBatchSelection } from "@/components/admin/batch/useBatchSelection";
import StatusChip from "@/components/admin/StatusChip";

import { formatCnDateTime } from "@/lib/datetime";
import type { KeywordAdminRow } from "@/lib/discovery/admin";
import { KEYWORD_STATUS_LABELS } from "@/lib/discovery/status";
import type { KeywordYield } from "@/lib/discovery/word-yield";

export interface KeywordTableTones {
  [key: string]: string;
}

export default function KeywordTable({
  items,
  tones,
  yieldByWord,
}: {
  items: KeywordAdminRow[];
  /** 状态色 tone 映射(页面持有,保持与候选表同源) */
  tones: KeywordTableTones;
  /** 词→产出聚合(批② 词动线;缺词=尚无候选命中,显 —) */
  yieldByWord: Record<string, KeywordYield>;
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
            <th className="px-4 py-2.5 font-medium">词</th>
            <th className="px-3 py-2.5 font-medium">来源</th>
            <th className="px-3 py-2.5 font-medium" title="该词命中的候选数与批准数(全部轮次累计)">
              产出
            </th>
            <th className="px-3 py-2.5 font-medium">状态</th>
            <th className="px-3 py-2.5 font-medium">首见时间</th>
            <th className="px-3 py-2.5 font-medium">确认时间</th>
            <th className="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((k) => (
            <tr key={k.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
              <td className="px-3 py-2.5">
                <RowCheckbox
                  label={`选择词「${k.word}」`}
                  checked={selected.has(k.id)}
                  onToggle={() => toggle(k.id)}
                />
              </td>
              <td className="px-4 py-2.5 font-medium text-text-1">{k.word}</td>
              <td className="px-3 py-2.5 text-xs text-text-2">
                {k.origin === "manual" ? (
                  "人工"
                ) : (
                  <span title={k.source ?? undefined}>联想{k.source ? ` · ${k.source}` : ""}</span>
                )}
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                {(() => {
                  const y = yieldByWord[k.word];
                  if (!y) return <span className="text-text-3">—</span>;
                  return (
                    <Link
                      href={`/admin/data/mine/?t=candidates&kw=${encodeURIComponent(k.word)}`}
                      title="查看该词挖到的候选"
                      className="hover:text-accent-hover hover:underline"
                    >
                      候选 {y.candidates}
                      {y.approved > 0 && (
                        <span className="ml-1 text-green">·批准 {y.approved}</span>
                      )}
                    </Link>
                  );
                })()}
              </td>
              <td className="px-3 py-2.5">
                <StatusChip
                  tone={tones[k.status] ?? "bg-panel-2 text-text-2"}
                  label={
                    KEYWORD_STATUS_LABELS[k.status as keyof typeof KEYWORD_STATUS_LABELS] ??
                    k.status
                  }
                />
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                {formatCnDateTime(k.firstSeenAt)}
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                {k.confirmedAt ? formatCnDateTime(k.confirmedAt) : "—"}
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
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-xs text-text-3">
                暂无关键词,可在上方人工添加或触发热词发现
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
