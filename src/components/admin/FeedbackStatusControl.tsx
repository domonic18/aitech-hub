"use client";

/**
 * 反馈行内状态流转(M22 批⑤,需求9):状态下拉 + 处理备注,保存走
 * PUT /api/feedback/[id](整行覆盖口径——备注空串=显式清空);成功
 * router.refresh 重拉本页(RSC 列表),脏值才可保存(UserStatusButton 同款收敛)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackStatus,
} from "@/lib/feedback/feedback-schema";
import type { ApiEnvelope } from "@/lib/http/response";

export default function FeedbackStatusControl({
  id,
  status,
  adminNote,
}: {
  id: string;
  status: string;
  adminNote: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<FeedbackStatus>(
    (FEEDBACK_STATUSES as readonly string[]).includes(status) ? (status as FeedbackStatus) : "open",
  );
  const [note, setNote] = useState(adminNote ?? "");

  const dirty = next !== status || note !== (adminNote ?? "");

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/feedback/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, adminNote: note.trim() }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        alert(`保存失败:${body.message}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <select
        value={next}
        onChange={(e) => setNext(e.target.value as FeedbackStatus)}
        aria-label="反馈状态"
        className="cursor-pointer rounded-sm border border-line bg-panel px-1.5 py-1 text-xs text-text-1 outline-none focus:border-accent"
      >
        {FEEDBACK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {FEEDBACK_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="处理备注…"
        maxLength={500}
        aria-label="处理备注"
        className="w-28 rounded-sm border border-line bg-panel px-1.5 py-1 text-xs outline-none placeholder:text-text-3 focus:border-accent"
      />
      <button
        type="button"
        onClick={save}
        disabled={busy || !dirty}
        className="cursor-pointer rounded-sm px-2 py-1 text-xs text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
      >
        保存
      </button>
    </div>
  );
}
