"use client";

/**
 * 电报治理表体(M31 验收反馈:多选批量归档/隐藏/删除;自 RSC 页抽出):
 * 勾选列(全选本页,格并入 TelegramItemRow 首格)+ BatchActionBar 三动作
 * ——归档/隐藏(可逆,直发)、删除(软删终态 deleted,确认后执行)。行展示
 * 复用 TelegramItemRow(纯展示,随客户端打包)、行内 TelegramRowOps 原样。
 * 批量编排/勾选格/动作钮走共享件(技术债批②;表头样式同步其余四表)。
 * 分页留 RSC 页(AdminPagination 需服务端 hrefFor)。
 */
import BatchButton from "../batch/BatchButton";
import BatchActionBar from "../batch/BatchActionBar";
import { SelectAllTh } from "../batch/SelectionCheckbox";
import { useBatchAction } from "../batch/useBatchAction";
import { useBatchSelection } from "../batch/useBatchSelection";
import TelegramItemRow from "./TelegramItemRow";

import type { TelegramAdminList } from "@/lib/telegram/telegram-admin";

type Item = TelegramAdminList["items"][number];

export default function TelegramTable({ items }: { items: Item[] }): React.ReactElement {
  const rowIds = items.map((t) => t.id);
  const { selected, allSelected, toggle, toggleAll, clear } = useBatchSelection(rowIds);
  const { busy, msg, error, runBatch } = useBatchAction(clear);

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
        <BatchButton
          variant="primary"
          label="批量归档"
          busyLabel="处理中…"
          busy={busy}
          disabled={busy || selected.size === 0}
          title="批量归档:移出前台信息流,列表「归档」段可见,可恢复"
          onClick={() =>
            runBatch({
              url: "/api/telegram/batch",
              body: { ids: [...selected], action: "archive" },
              donePrefix: "已处理",
            })
          }
        />
        <BatchButton
          variant="outline"
          label="批量隐藏"
          busy={busy}
          disabled={busy || selected.size === 0}
          title="批量隐藏:前台不可见,列表「隐藏」段可见,可恢复"
          onClick={() =>
            runBatch({
              url: "/api/telegram/batch",
              body: { ids: [...selected], action: "hide" },
              donePrefix: "已处理",
            })
          }
        />
        <BatchButton
          variant="danger"
          label="批量删除"
          busy={busy}
          disabled={busy || selected.size === 0}
          title="批量删除:软删终态,不可恢复"
          onClick={() =>
            runBatch({
              url: "/api/telegram/batch",
              body: { ids: [...selected], action: "delete" },
              confirm: `确认删除选中的 ${selected.size} 条?删除为终态,列表/前台均不可见且无法恢复。`,
              donePrefix: "已处理",
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
