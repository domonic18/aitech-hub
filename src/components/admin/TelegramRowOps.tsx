"use client";

/**
 * 电报条目行操作(M7 批④):状态迁移(按当前态给 恢复/隐藏/归档)+ 标题摘要
 * 人工修正弹窗。deleted 终态不经 UI。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

const ACTIONS: Record<string, Array<{ label: string; to: string; danger?: boolean }>> = {
  visible: [
    { label: "隐藏", to: "hidden", danger: true },
    { label: "归档", to: "archived" },
  ],
  hidden: [
    { label: "恢复", to: "visible" },
    { label: "归档", to: "archived" },
  ],
  archived: [
    { label: "恢复", to: "visible" },
    { label: "隐藏", to: "hidden", danger: true },
  ],
};

const field =
  "w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-sm outline-none focus:border-accent";

export default function TelegramRowOps({
  id,
  title,
  summary,
  status,
}: {
  id: string;
  title: string | null;
  summary: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(title ?? "");
  const [editSummary, setEditSummary] = useState(summary);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/telegram/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const resp = (await res.json()) as { code: number; message: string };
      if (resp.code !== 0) {
        alert(`操作失败:${resp.message}`);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const saveEdit = async (): Promise<void> => {
    const ok = await patch({ title: editTitle.trim(), summary: editSummary.trim() });
    if (ok) setOpen(false);
  };

  return (
    <div className="flex items-center justify-end gap-1 text-xs">
      {(ACTIONS[status] ?? []).map((a) => (
        <button
          key={a.to}
          type="button"
          disabled={busy}
          onClick={() => void patch({ status: a.to })}
          className={`cursor-pointer rounded-sm px-2 py-1 disabled:opacity-50 ${
            a.danger ? "text-red hover:bg-red/10" : "text-accent hover:bg-accent-dim"
          }`}
        >
          {a.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2"
      >
        编辑
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-md border border-line bg-panel p-5 shadow-xl">
            <h3 className="text-sm font-semibold">修正条目(#{id})</h3>
            <label className="mt-3 block text-xs text-text-3">
              标题(≤500)
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={500}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="mt-3 block text-xs text-text-3">
              摘要(≤1000)
              <textarea
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                rows={4}
                maxLength={1000}
                className={`mt-1 ${field}`}
              />
            </label>
            {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || editTitle.trim() === "" || editSummary.trim() === ""}
                onClick={() => void saveEdit()}
                className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
