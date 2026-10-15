"use client";

/**
 * 词库管理表体(M31 验收反馈:多选批量生效/弃用;自 RSC 页抽出):勾选列
 * (全选本页)+ BatchActionBar 两动作(生效 active / 弃用 dismissed,三态
 * 可逆直发,与行内 StatusControl 同语义无确认步)。行内 StatusControl 原样。
 * 候选表不在本件范围;分页留 RSC 页。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import StatusControl from "./StatusControl";
import BatchActionBar from "@/components/admin/batch/BatchActionBar";
import { outcomeText, postBatch } from "@/components/admin/batch/batch-client";
import { useBatchSelection } from "@/components/admin/batch/useBatchSelection";

import { formatCnDateTime } from "@/lib/datetime";
import type { KeywordAdminRow } from "@/lib/discovery/admin";
import { KEYWORD_STATUS_LABELS } from "@/lib/discovery/status";

export interface KeywordTableTones {
  [key: string]: string;
}

/** 状态小徽(页面 StatusChip 同款内联,候选表仍是页内实现,暂不抽共享) */
function Chip({ tone, label }: { tone: string; label: string }): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

export default function KeywordTable({
  items,
  tones,
}: {
  items: KeywordAdminRow[];
  /** 状态色 tone 映射(页面持有,保持与候选表同源) */
  tones: KeywordTableTones;
}): React.ReactElement {
  const router = useRouter();
  const rowIds = items.map((k) => k.id);
  const { selected, allSelected, toggle, toggleAll, clear } = useBatchSelection(rowIds);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runBatch(action: "activate" | "dismiss"): void {
    setBusy(true);
    setError(null);
    setMsg(null);
    void postBatch("/api/discovery/keywords/batch", { ids: [...selected], action }).then((r) => {
      if (r.ok && r.data) {
        setMsg(outcomeText(action === "activate" ? "已生效" : "已弃用", r.data));
        clear();
        router.refresh();
      } else {
        setError(r.message ?? "批量操作失败");
      }
      setBusy(false);
    });
  }

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
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => runBatch("activate")}
          title="批量生效:加入发现轮取词,与行内「生效」同语义(记确认时间)"
          className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "处理中…" : "批量生效"}
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => runBatch("dismiss")}
          title="批量弃用:不参与发现轮,可再恢复"
          className="cursor-pointer rounded-sm border border-red/50 bg-transparent px-3 py-1.5 text-xs font-medium text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          批量弃用
        </button>
      </BatchActionBar>

      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
            <th className="w-10 px-3 py-2.5">
              <input
                type="checkbox"
                aria-label="全选本页"
                className="accent-[var(--accent)]"
                checked={allSelected}
                onChange={toggleAll}
                disabled={items.length === 0}
              />
            </th>
            <th className="px-4 py-2.5 font-medium">词</th>
            <th className="px-3 py-2.5 font-medium">来源</th>
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
                <input
                  type="checkbox"
                  aria-label={`选择词「${k.word}」`}
                  className="accent-[var(--accent)]"
                  checked={selected.has(k.id)}
                  onChange={() => toggle(k.id)}
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
              <td className="px-3 py-2.5">
                <Chip
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
              <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                暂无关键词,可在上方人工添加或触发热词发现
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
