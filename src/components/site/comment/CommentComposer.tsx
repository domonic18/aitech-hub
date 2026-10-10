"use client";

/**
 * 评论输入(M23 批②):未登录 → 「登录后评论」引导(next=当前路径回跳);
 * 已登录 → 头像 + 昵称 + textarea(maxLength=1000,纯文字)。提交走
 * POST /api/post-comments(先发后审,成功即上屏);屏蔽词/限流的
 * 服务端文案原样展示。回复形态由 parentId 区分(内联窄一档)。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { COMMENT_LIMITS } from "@/lib/comment/comment-schema";

import Avatar from "../Avatar";
import type { CommentNode, SessionUser } from "./types";

interface Props {
  postId: string;
  user: SessionUser | null;
  /** 有值 = 楼内回复(挂根 id,两级封顶) */
  parentId?: string;
  placeholder?: string;
  compact?: boolean;
  onCancel?: () => void;
  onCreated: (node: CommentNode) => void;
}

export default function CommentComposer({
  postId,
  user,
  parentId,
  placeholder,
  compact = false,
  onCancel,
  onCreated,
}: Props): React.ReactElement {
  const pathname = usePathname();
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user === null) {
    return (
      <div
        className={`flex items-center justify-between gap-3 rounded-md border border-line bg-panel-2 px-4 ${
          compact ? "py-2.5 text-xs" : "py-3.5 text-sm"
        }`}
      >
        <span className="text-text-3">登录后即可评论</span>
        <Link
          href={`/login?next=${encodeURIComponent(pathname)}`}
          className="rounded-sm border border-accent/40 px-3 py-1.5 text-accent hover:bg-accent/10"
        >
          登录
        </Link>
      </div>
    );
  }

  async function submit(): Promise<void> {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/post-comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId, content: text, parentId }),
      });
      const b = (await r.json()) as {
        code: number;
        message: string;
        data?: { item: CommentNode };
      };
      if (b.code === 0 && b.data?.item) {
        setContent("");
        onCreated(b.data.item);
      } else {
        setError(b.message || "发布失败,请稍后再试");
      }
    } catch {
      setError("网络异常,请稍后再试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex gap-3 ${compact ? "mt-3" : ""}`}>
      <Avatar nickname={user.nickname} avatarPath={user.avatarPath} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="rounded-md border border-line bg-panel focus-within:border-accent/50">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={COMMENT_LIMITS.content.max}
            rows={compact ? 2 : 3}
            placeholder={placeholder ?? "写下你的评论…"}
            className="w-full resize-y rounded-md bg-transparent px-3.5 py-2.5 text-sm leading-relaxed text-text-1 outline-none placeholder:text-text-3"
          />
          <div className="flex items-center justify-between border-t border-line px-3 py-2">
            <span className="font-mono text-[11px] text-text-3">
              {content.length}/{COMMENT_LIMITS.content.max}
            </span>
            <div className="flex items-center gap-2">
              {onCancel ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="cursor-pointer rounded-sm px-2.5 py-1 text-xs text-text-3 hover:text-text-1"
                >
                  取消
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || content.trim().length === 0}
                className="cursor-pointer rounded-sm bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "发布中…" : "发布"}
              </button>
            </div>
          </div>
        </div>
        {error ? <p className="mt-1.5 text-xs text-red">{error}</p> : null}
      </div>
    </div>
  );
}
