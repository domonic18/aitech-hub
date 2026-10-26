"use client";

/**
 * 评论点赞钮(M23 批②):初始态随列表 GET 下发(不单独请求);点击 toggle
 * (游客可赞,同目标一次,再点取消),busy 防抖兜双击并发。失败静默保原态。
 */
import { useState } from "react";

export default function CommentLikeButton({
  commentId,
  liked,
  count,
}: {
  commentId: string;
  liked: boolean;
  count: number;
}): React.ReactElement {
  const [state, setState] = useState({ liked, count });
  const [busy, setBusy] = useState(false);

  async function toggle(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/comment-like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commentId }),
      });
      const b = (await r.json()) as { code: number; data?: { liked: boolean; count: number } };
      if (b.code === 0 && b.data) setState(b.data);
    } catch {
      // 网络失败保原态,不打断阅读
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={state.liked}
      title={state.liked ? "取消点赞" : "点赞"}
      className={`inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-red ${
        state.liked ? "text-red" : "text-text-3"
      }`}
    >
      <svg className="ic ic-sm" aria-hidden="true">
        <use href="#i-like" />
      </svg>
      {state.count > 0 ? <span>{state.count}</span> : <span>赞</span>}
    </button>
  );
}
