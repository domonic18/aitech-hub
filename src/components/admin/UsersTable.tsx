"use client";

/**
 * 用户管理表体(M31 验收反馈:多选批量启用/停用;自 RSC 页抽出):勾选列
 * (全选本页;当前登录行禁勾)+ BatchActionBar 启用/停用两动作——停用须
 * 确认(连带吊销全部 PAT,与单条同语义),自身行服务端兜底跳过。行内
 * UserStatusButton 原样。分页留 RSC 页。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import BatchActionBar from "./batch/BatchActionBar";
import { outcomeText, postBatch } from "./batch/batch-client";
import { useBatchSelection } from "./batch/useBatchSelection";
import UserStatusButton from "./UserStatusButton";

import { maskPhone } from "@/lib/auth/mask";
import { formatCnDateTime } from "@/lib/datetime";
import type { AdminUserRow } from "@/lib/users/admin-users";
import { USER_STATUS_DISABLED } from "@/lib/users/user-status";

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: "active", cls: "bg-green/12 text-green" },
    pending_binding: { label: "待绑定", cls: "bg-amber/12 text-amber-hi" },
    disabled: { label: "已禁用", cls: "bg-panel-2 text-text-3" },
  };
  const s = map[status] ?? { label: status, cls: "bg-panel-2 text-text-2" };
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium ${s.cls}`}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {s.label}
    </span>
  );
}

export default function UsersTable({
  items,
  selfId,
}: {
  items: AdminUserRow[];
  /** 当前登录用户 id(该行禁勾选,防自锁) */
  selfId: string;
}): React.ReactElement {
  const router = useRouter();
  const rowIds = items.map((u) => u.id);
  const { selected, allSelected, toggle, toggleAll, clear } = useBatchSelection(rowIds);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runBatch(status: "active" | "disabled"): void {
    if (
      status === "disabled" &&
      !window.confirm("确认停用选中的用户?其全部 PAT 将立即失效(可再启用恢复)。")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    void postBatch("/api/users/batch-status", { ids: [...selected], status }).then((r) => {
      if (r.ok && r.data) {
        setMsg(outcomeText(status === "active" ? "已启用" : "已停用", r.data));
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
        unit="位"
        count={selected.size}
        busy={busy}
        msg={msg}
        error={error}
        onCancel={clear}
      >
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => runBatch("active")}
          title="批量启用:恢复登录与 PAT 有效"
          className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "处理中…" : "批量启用"}
        </button>
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={() => runBatch("disabled")}
          title="批量停用:连带吊销全部 PAT(当前登录账号自动跳过)"
          className="cursor-pointer rounded-sm border border-red/50 bg-transparent px-3 py-1.5 text-xs font-medium text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          批量停用
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
            <th className="px-4 py-2.5 font-medium">用户</th>
            <th className="px-3 py-2.5 font-medium">邮箱</th>
            <th className="px-3 py-2.5 font-medium">角色</th>
            <th className="px-3 py-2.5 font-medium">状态</th>
            <th className="px-3 py-2.5 font-medium">注册时间</th>
            <th className="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => {
            const self = u.id === selfId;
            return (
              <tr
                key={u.id}
                className={`border-b border-line last:border-b-0 hover:bg-panel-2 ${
                  u.status === USER_STATUS_DISABLED ? "opacity-70" : ""
                }`}
              >
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={self ? "当前登录账号,不可批量操作" : `选择 ${u.nickname ?? u.id}`}
                    className="accent-[var(--accent)]"
                    checked={!self && selected.has(u.id)}
                    onChange={() => toggle(u.id)}
                    disabled={self}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    {u.avatarPath ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 管理端内部头像,src 为站内动态路径
                      <img
                        src={u.avatarPath}
                        alt=""
                        className="h-9 w-9 rounded-full border border-line object-cover"
                      />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel-2 text-sm text-text-3">
                        {(u.nickname ?? "?").slice(0, 1)}
                      </span>
                    )}
                    <div>
                      <div className="font-medium text-text-1">{u.nickname ?? "未命名"}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-text-3">
                        {maskPhone(u.phone)} · uid {u.id}
                      </div>
                    </div>
                  </div>
                </td>
                <td
                  className="max-w-[200px] truncate px-3 py-2.5 font-mono text-xs text-text-2"
                  title={u.email ?? undefined}
                >
                  {u.email ?? <span className="text-text-3">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  {u.role === "admin" ? (
                    <span className="rounded-sm bg-accent-dim px-1.5 py-0.5 font-mono text-[11px] text-accent">
                      admin
                    </span>
                  ) : (
                    <span className="rounded-sm bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
                      user
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={u.status} />
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                  {formatCnDateTime(u.createdAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {self ? (
                    <span className="font-mono text-[11px] text-text-3">当前登录</span>
                  ) : (
                    <UserStatusButton id={u.id} nickname={u.nickname} status={u.status} />
                  )}
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-xs text-text-3">
                没有符合条件的用户
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
