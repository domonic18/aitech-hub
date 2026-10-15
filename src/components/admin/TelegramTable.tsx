"use client";

/**
 * 电报治理表体(M31 验收反馈:多选批量归档/隐藏/删除;自 RSC 页抽出):
 * 勾选列(全选本页,格并入 TelegramItemRow 首格)+ BatchActionBar 三动作
 * ——归档/隐藏(可逆,直发)、删除(软删终态 deleted,确认后执行)。行展示
 * 复用 TelegramItemRow(纯展示,随客户端打包)、行内 TelegramRowOps 原样。
 * 分页留 RSC 页(AdminPagination 需服务端 hrefFor)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import BatchActionBar from "./batch/BatchActionBar";
import { outcomeText, postBatch } from "./batch/batch-client";
import { useBatchSelection } from "./batch/useBatchSelection";
import TelegramItemRow from "./TelegramItemRow";

import {
  TELEGRAM_STATUS_ARCHIVED,
  TELEGRAM_STATUS_DELETED,
  TELEGRAM_STATUS_HIDDEN,
} from "@/lib/telegram/constants";
import type { TelegramAdminList } from "@/lib/telegram/telegram-admin";

type Item = TelegramAdminList["items"][number];

/** 批量动作 → 目标状态(delete = 软删终态,列表/前台均不再可见) */
const ACTIONS = {
  archive: { status: TELEGRAM_STATUS_ARCHIVED, confirm: null },
  hide: { status: TELEGRAM_STATUS_HIDDEN, confirm: null },
  delete: {
    status: TELEGRAM_STATUS_DELETED,
    confirm: (n: number) => `确认删除选中的 ${n} 条?删除为终态,列表/前台均不可见且无法恢复。`,
  },
} as const;

export default function TelegramTable({ items }: { items: Item[] }): React.ReactElement {
  const router = useRouter();
  const rowIds = items.map((t) => t.id);
  const { selected, allSelected, toggle, toggleAll, clear } = useBatchSelection(rowIds);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runBatch(action: keyof typeof ACTIONS): void {
    const spec = ACTIONS[action];
    const ids = [...selected];
    if (spec.confirm !== null && !window.confirm(spec.confirm(ids.length))) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    void postBatch("/api/telegram/batch", { ids, action }).then((r) => {
      if (r.ok && r.data) {
        setMsg(outcomeText("已处理", r.data));
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
        unit="条"
        count={selected.size}
        busy={busy}
        msg={msg}
        error={error}
        onCancel={clear}
      >
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => runBatch("archive")}
          title="批量归档:移出前台信息流,列表「归档」段可见,可恢复"
          className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "处理中…" : "批量归档"}
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => runBatch("hide")}
          title="批量隐藏:前台不可见,列表「隐藏」段可见,可恢复"
          className="cursor-pointer rounded-sm border border-accent/50 bg-transparent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-60"
        >
          批量隐藏
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => runBatch("delete")}
          title="批量删除:软删终态,不可恢复"
          className="cursor-pointer rounded-sm border border-red/50 bg-transparent px-3 py-1.5 text-xs font-medium text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          批量删除
        </button>
      </BatchActionBar>

      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-line text-xs text-text-3">
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
            <th className="px-4 py-2.5 font-medium">条目</th>
            <th className="px-3 py-2.5 font-medium">媒体</th>
            <th className="px-3 py-2.5 font-medium">来源</th>
            <th className="px-3 py-2.5 font-medium">过滤命中</th>
            <th className="px-3 py-2.5 font-medium">状态</th>
            <th className="px-3 py-2.5 font-medium">时间</th>
            <th className="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <TelegramItemRow
              key={t.id}
              item={t}
              checkbox={{ checked: selected.has(t.id), onToggle: () => toggle(t.id) }}
            />
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-xs text-text-3">
                没有符合条件的条目
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
