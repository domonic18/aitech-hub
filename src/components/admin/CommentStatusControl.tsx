"use client";

/**
 * 评论行内治理(M23 批③):状态下拉(显示/隐藏两态互切,先发后审口径)+
 * 删除钮(原生 confirm 明示连带回复数)。流转走 PUT /api/post-comments/[id],
 * 删除走 DELETE(物理不可逆);成功 router.refresh 重拉 RSC 列表
 * (FeedbackStatusControl 同款收敛)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  COMMENT_STATUSES,
  COMMENT_STATUS_LABELS,
  type CommentStatus,
} from "@/lib/comment/comment-schema";
import type { ApiEnvelope } from "@/lib/http/response";

export default function CommentStatusControl({
  id,
  status,
  replyCount,
}: {
  id: string;
  status: string;
  /** 直接子评论数(删除连带提示用;根评论才可能 > 0) */
  replyCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState<CommentStatus>(
    (COMMENT_STATUSES as readonly string[]).includes(status)
      ? (status as CommentStatus)
      : "visible",
  );

  const dirty = next !== status;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/post-comments/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
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

  async function remove(): Promise<void> {
    const tip =
      replyCount > 0
        ? `物理删除该评论及其 ${replyCount} 条回复(连带点赞),不可恢复。确定?`
        : "物理删除该评论(连带点赞),不可恢复。确定?";
    if (!window.confirm(tip)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/post-comments/${id}`, { method: "DELETE" });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        alert(`删除失败:${body.message}`);
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
        onChange={(e) => setNext(e.target.value as CommentStatus)}
        aria-label="评论状态"
        className="cursor-pointer rounded-sm border border-line bg-panel px-1.5 py-1 text-xs text-text-1 outline-none focus:border-accent"
      >
        {COMMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {COMMENT_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={save}
        disabled={busy || !dirty}
        className="cursor-pointer rounded-sm px-2 py-1 text-xs text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
      >
        保存
      </button>
      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy}
        className="cursor-pointer rounded-sm px-2 py-1 text-xs text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        删除
      </button>
    </div>
  );
}
