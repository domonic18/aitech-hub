"use client";

/**
 * 素材卡行内操作(M26 批③治理台):批注内联编辑(PATCH …/items/[itemId],
 * 空串=清批注)+ 卸载(DELETE,可重挂不做确认步)。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";

export default function TopicItemActions({
  topicId,
  itemId,
  note,
}: {
  topicId: string;
  itemId: string;
  note: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function saveNote(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/topics/${topicId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: draft.trim() === "" ? null : draft.trim() }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (!res.ok || body.code !== 0) {
        setErr(body.message || `保存失败(${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setErr("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  }

  async function unmount(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/topics/${topicId}/items/${itemId}`, { method: "DELETE" });
      const body = (await res.json()) as ApiEnvelope;
      if (!res.ok || body.code !== 0) {
        setErr(body.message || `卸载失败(${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setErr("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          value={draft}
          maxLength={500}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="批注(给生成初稿的定向提示,≤500 字符;空=清除)…"
          className="w-full rounded-sm border border-line bg-panel px-2 py-1 text-[12px] outline-none focus:border-accent placeholder:text-text-3"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveNote()}
            disabled={busy}
            className="rounded-sm bg-accent px-2.5 py-0.5 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
          >
            保存批注
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft(note ?? "");
              setErr(null);
            }}
            className="text-xs text-text-2 hover:text-text-1"
          >
            取消
          </button>
          {err && <span className="text-[11px] text-red">{err}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-sm border border-line px-2 py-0.5 text-xs text-text-2 hover:border-accent hover:text-text-1"
        >
          {note ? "改批注" : "加批注"}
        </button>
        <button
          type="button"
          onClick={() => void unmount()}
          disabled={busy}
          className="rounded-sm border border-line px-2 py-0.5 text-xs text-text-2 hover:border-red hover:text-red disabled:opacity-50"
        >
          卸载
        </button>
      </div>
      {err && (
        <span className="max-w-48 text-right text-[11px] text-red" role="alert">
          {err}
        </span>
      )}
    </div>
  );
}
