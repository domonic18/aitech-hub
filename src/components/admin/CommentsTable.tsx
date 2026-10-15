"use client";

/**
 * 评论管理表体(M31 验收反馈:多选批量删除;自 RSC 页抽出):勾选列(全选
 * 本页)+ BatchActionBar(批量删除,连带回复物理删,确认后执行)+ 行内容
 * 与行内状态操作(CommentStatusControl 原样)。分页留 RSC 页(AdminPagination
 * 需服务端 hrefFor)。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import BatchActionBar from "./batch/BatchActionBar";
import { outcomeText, postBatch } from "./batch/batch-client";
import { useBatchSelection } from "./batch/useBatchSelection";
import CommentStatusControl from "./CommentStatusControl";

import { formatCnDateTime } from "@/lib/datetime";
import { postPath } from "@/lib/content/post-path";
import type { AdminCommentRow } from "@/lib/comment/comment-admin";
import { COMMENT_STATUS_LABELS, type CommentStatus } from "@/lib/comment/comment-schema";

const STATUS_TONES: Record<CommentStatus, string> = {
  visible: "bg-green/12 text-green",
  hidden: "bg-amber/12 text-amber-hi",
};

export default function CommentsTable({ items }: { items: AdminCommentRow[] }): React.ReactElement {
  const router = useRouter();
  const rowIds = items.map((c) => c.id);
  const { selected, allSelected, toggle, toggleAll, clear } = useBatchSelection(rowIds);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 批量删除(连带回复与点赞行,物理不可逆;单条语义逐条容错) */
  function runDeleteBatch(): void {
    if (
      !window.confirm(
        `确认删除选中的 ${selected.size} 条评论?连带回复与点赞一并物理删除,不可恢复。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    void postBatch<{ updated: number; skipped: Array<{ id: string; reason: string }> }>(
      "/api/post-comments/batch-delete",
      { ids: [...selected] },
    ).then((r) => {
      if (r.ok && r.data) {
        setMsg(outcomeText("已删除", r.data));
        clear();
        router.refresh();
      } else {
        setError(r.message ?? "批量删除失败");
      }
      setBusy(false);
    });
  }

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
        <button
          type="button"
          disabled={busy || selected.size === 0}
          onClick={runDeleteBatch}
          title="物理删除选中评论,连带直接回复与点赞行"
          className="cursor-pointer rounded-sm border border-red/50 bg-transparent px-3 py-1.5 text-xs font-medium text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "删除中…" : "批量删除"}
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
            <th className="px-4 py-2.5 font-medium">作者</th>
            <th className="px-3 py-2.5 font-medium">内容</th>
            <th className="px-3 py-2.5 font-medium">所属文章</th>
            <th className="px-3 py-2.5 font-medium">楼层</th>
            <th className="px-3 py-2.5 font-medium">状态</th>
            <th className="px-3 py-2.5 font-medium">时间</th>
            <th className="px-4 py-2.5 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
              <td className="px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label={`选择 ${c.authorName} 的评论`}
                  className="accent-[var(--accent)]"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-1.5 text-text-1">
                  <span className="max-w-[120px] truncate" title={c.authorName}>
                    {c.authorName}
                  </span>
                  {c.migrated ? (
                    <span className="rounded-sm border border-line px-1 py-px font-mono text-[10px] text-text-3">
                      WP
                    </span>
                  ) : null}
                </div>
                {c.userId ? (
                  <div className="mt-0.5 font-mono text-[11px] text-text-3">uid {c.userId}</div>
                ) : null}
              </td>
              <td className="max-w-[300px] px-3 py-2.5">
                <div className="truncate text-text-1" title={c.content}>
                  {c.content}
                </div>
              </td>
              <td className="max-w-[200px] truncate px-3 py-2.5">
                <Link
                  href={postPath(BigInt(c.postId), c.postSlug)}
                  className="text-text-2 hover:text-accent"
                  title={c.postTitle}
                >
                  {c.postTitle}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-xs text-text-2">
                {c.parentId === null ? (
                  <span>
                    根
                    {c.replyCount > 0 ? (
                      <span className="ml-1 font-mono text-text-3">+{c.replyCount}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-text-3">回复</span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_TONES[c.status] ?? ""}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                  {COMMENT_STATUS_LABELS[c.status] ?? c.status}
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-text-2">
                {formatCnDateTime(c.createdAt)}
              </td>
              <td className="px-4 py-2.5">
                <CommentStatusControl id={c.id} status={c.status} replyCount={c.replyCount} />
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-xs text-text-3">
                没有符合条件的评论
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
