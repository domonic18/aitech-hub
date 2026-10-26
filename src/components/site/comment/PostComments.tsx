"use client";

/**
 * 评论区 island 根(M23 批②):挂载后并行取 /api/post-comments(分页列表)
 * + /api/auth/session(不读 cookie 保文章页 ISR 静态面)。根评论 createdAt
 * desc 分页、「加载更多」追加;回复挂根两级封顶。新发评论本地插入:
 * 根前插 / 回复追加到所属根的 replies(与 service 下发结构同构)。
 */
import { useCallback, useEffect, useState } from "react";

import CommentComposer from "./CommentComposer";
import CommentItem from "./CommentItem";
import type { CommentNode, SessionUser } from "./types";

interface ListPayload {
  items: CommentNode[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export default function PostComments({ postId }: { postId: string }): React.ReactElement {
  const [roots, setRoots] = useState<CommentNode[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  /** undefined=取数中,null=未登录,对象=已登录(HeaderSession 同款) */
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  const load = useCallback(
    async (nextPage: number): Promise<void> => {
      const r = await fetch(
        `/api/post-comments?postId=${encodeURIComponent(postId)}&page=${nextPage}`,
      );
      const b = (await r.json()) as { code: number; data?: ListPayload };
      if (b.code !== 0 || !b.data) return;
      setRoots((prev) => (nextPage === 1 ? b.data!.items : [...(prev ?? []), ...b.data!.items]));
      setTotal(b.data.total);
      setHasMore(b.data.hasMore);
      setPage(b.data.page);
    },
    [postId],
  );

  useEffect(() => {
    void load(1).catch(() => setRoots([]));
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((b: { data?: { user: SessionUser | null } | null }) => setUser(b.data?.user ?? null))
      .catch(() => setUser(null));
  }, [load]);

  function onCreated(node: CommentNode, parent: CommentNode | null): void {
    if (parent === null) {
      setRoots((prev) => [node, ...(prev ?? [])]);
      setTotal((t) => t + 1);
      return;
    }
    // 回复挂根:parent 即根(两级封顶,子评论的 onCreated 由 CommentItem 透传根)
    setRoots((prev) =>
      (prev ?? []).map((root) =>
        root.id === parent.id ? { ...root, replies: [...(root.replies ?? []), node] } : root,
      ),
    );
    setTotal((t) => t + 1);
  }

  async function loadMore(): Promise<void> {
    setLoadingMore(true);
    try {
      await load(page + 1);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="mt-8" aria-label="文章评论">
      <h2 className="font-mono text-sm font-semibold tracking-wider text-text-1">
        [评论 <span className="text-accent">{total}</span>]
      </h2>

      <div className="mt-4">
        <PostCommentsComposer postId={postId} user={user} onCreated={onCreated} />
      </div>

      {roots === null ? (
        <p className="mt-6 text-sm text-text-3">评论加载中…</p>
      ) : roots.length === 0 ? (
        <p className="mt-6 text-sm text-text-3">还没有评论,来抢沙发。</p>
      ) : (
        <div className="mt-2 divide-y divide-line/60">
          {roots.map((c) => (
            <CommentItem key={c.id} postId={postId} comment={c} user={user} onCreated={onCreated} />
          ))}
        </div>
      )}

      {hasMore ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="cursor-pointer rounded-sm border border-line px-4 py-2 text-sm text-text-2 hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore ? "加载中…" : "加载更多评论"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** 顶层 composer 包装:登录态未定(取数中)不渲染,防闪烁;新发根评论前插 */
function PostCommentsComposer({
  postId,
  user,
  onCreated,
}: {
  postId: string;
  user: SessionUser | null | undefined;
  onCreated: (node: CommentNode, parent: CommentNode | null) => void;
}): React.ReactElement | null {
  if (user === undefined) return null;
  return <CommentComposer postId={postId} user={user} onCreated={(n) => onCreated(n, null)} />;
}
