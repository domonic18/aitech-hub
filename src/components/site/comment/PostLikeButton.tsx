"use client";

/**
 * 文章点赞钮(M23 批②,原型 .end-actions 位置):挂载后 GET /api/post-like
 * 取 {liked, count} 初始化;点击 toggle(游客可赞,同文一次,再点取消)。
 * busy 防抖 + 服务端 identityKey 去重双保险。
 */
import { useEffect, useState } from "react";

interface LikeState {
  liked: boolean;
  count: number;
}

export default function PostLikeButton({ postId }: { postId: string }): React.ReactElement {
  const [state, setState] = useState<LikeState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/post-like?postId=${encodeURIComponent(postId)}`)
      .then((r) => r.json())
      .then((b: { code: number; data?: LikeState }) => {
        if (b.code === 0 && b.data) setState(b.data);
      })
      .catch(() => undefined);
  }, [postId]);

  async function toggle(): Promise<void> {
    if (busy || state === null) return;
    setBusy(true);
    try {
      const r = await fetch("/api/post-like", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const b = (await r.json()) as { code: number; data?: LikeState };
      if (b.code === 0 && b.data) setState(b.data);
    } catch {
      // 网络失败保原态
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={state?.liked ?? false}
      title={state?.liked ? "取消点赞" : "点赞这篇文章"}
      className={`inline-flex cursor-pointer items-center gap-2 rounded-sm border px-4 py-2 text-sm transition-colors ${
        state?.liked
          ? "border-red/40 bg-red/5 text-red"
          : "border-line text-text-2 hover:border-red/40 hover:text-red"
      }`}
    >
      <svg className="ic" aria-hidden="true">
        <use href="#i-like" />
      </svg>
      {state === null ? "点赞" : state.liked ? "已赞" : "点赞"}
      {state !== null && state.count > 0 ? (
        <span className="font-mono text-xs">{state.count}</span>
      ) : null}
    </button>
  );
}
