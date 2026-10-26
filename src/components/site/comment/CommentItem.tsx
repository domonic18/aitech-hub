"use client";

/**
 * 单条评论(M23 批②):头像首字 + 昵称 + 「旧站」迁移徽标 + 日期;
 * 纯文本渲染(whitespace-pre-wrap,React 转义,不渲染 md/自动链接);
 * 仅根评论出「回复」钮(内联二级 composer,parentId=根 id,两级封顶),
 * 子评论平铺在竖线缩进区;均带点赞钮。
 */
import { useState } from "react";

import { formatCnDate } from "@/lib/datetime";

import Avatar from "../Avatar";
import CommentComposer from "./CommentComposer";
import CommentLikeButton from "./CommentLikeButton";
import type { CommentNode, SessionUser } from "./types";

interface Props {
  postId: string;
  comment: CommentNode;
  user: SessionUser | null | undefined;
  onCreated: (node: CommentNode, parent: CommentNode) => void;
}

export default function CommentItem({
  postId,
  comment,
  user,
  onCreated,
}: Props): React.ReactElement {
  const [replying, setReplying] = useState(false);
  const replies = comment.replies ?? [];
  const isRoot = comment.parentId === null;

  function handleReplyCreated(node: CommentNode): void {
    setReplying(false);
    onCreated(node, comment);
  }

  return (
    <article className="py-4">
      <div className="flex gap-3">
        <Avatar nickname={comment.authorName} avatarPath={null} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-text-1">{comment.authorName}</span>
            {comment.migrated ? (
              <span className="rounded-sm border border-line px-1 py-px font-mono text-[10px] text-text-3">
                旧站
              </span>
            ) : null}
            <time className="font-mono text-text-3">
              {formatCnDate(new Date(comment.createdAt))}
            </time>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-2">
            {comment.content}
          </p>
          <div className="mt-1.5 flex items-center gap-4 text-xs">
            {isRoot ? (
              <button
                type="button"
                onClick={() => setReplying((v) => !v)}
                className="cursor-pointer text-text-3 transition-colors hover:text-accent"
              >
                {replying ? "收起回复" : "回复"}
              </button>
            ) : null}
            <CommentLikeButton
              commentId={comment.id}
              liked={comment.liked}
              count={comment.likeCount}
            />
          </div>
          {replying && user !== undefined ? (
            <div className="mt-2">
              <CommentComposer
                postId={postId}
                user={user}
                parentId={comment.id}
                placeholder={`回复 ${comment.authorName}…`}
                compact
                onCancel={() => setReplying(false)}
                onCreated={handleReplyCreated}
              />
            </div>
          ) : null}
        </div>
      </div>
      {replies.length > 0 ? (
        <div className="mt-1 ml-4 space-y-1 border-l border-line pl-4 sm:ml-7">
          {replies.map((r) => (
            <CommentItem key={r.id} postId={postId} comment={r} user={user} onCreated={onCreated} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
