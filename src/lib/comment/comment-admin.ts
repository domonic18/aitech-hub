/**
 * 评论管理读侧 + 治理写侧(M23 批③,仿 feedback-admin 模式):列表按状态
 * 分段(all/visible/hidden)+ 关键词搜索 + 分页;写侧 = 隐藏/恢复流转 +
 * 物理删除(删根连带直接子与点赞行,事务内显式收集——parentId 自引用无 FK,
 * 级联不会自动发生)。admin 页 RSC 直调,不开公开 API(feedback 同款)。
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import { COMMENT_STATUSES, COMMENT_STATUS_LABELS, type CommentStatus } from "./comment-schema";
import { collectCommentWithReplies, CommentError } from "./comment-service";

export const COMMENT_ADMIN_PAGE_SIZE = 15;

/** 分段(原型 admin tab 惯例):全部 + 两状态(先发后审,无 pending 段) */
export const COMMENT_LIST_SEGMENTS = ["all", ...COMMENT_STATUSES] as const;
export type CommentListSegment = (typeof COMMENT_LIST_SEGMENTS)[number];

export interface CommentListQuery {
  page: number;
  segment: CommentListSegment;
  q?: string;
}

export interface AdminCommentRow {
  id: string;
  postId: string;
  postTitle: string;
  postSlug: string | null;
  parentId: string | null;
  userId: string | null;
  authorName: string;
  content: string;
  status: CommentStatus;
  /** WP 迁移评论(wpCommentId 非空),列「WP 迁移」徽标 */
  migrated: boolean;
  createdAt: Date;
  /** 直接子评论数(根评论 > 0;删除连带提示用) */
  replyCount: number;
}

function segmentWhere(segment: CommentListSegment, q?: string) {
  const text = q
    ? {
        OR: [{ content: { contains: q } }, { authorName: { contains: q } }],
      }
    : {};
  if (segment === "all") return text;
  return { ...text, status: segment };
}

/** 评论列表 + 分段计数(新评论优先);post 标题随行供跳转 */
export async function listCommentsAdmin({ page, segment, q }: CommentListQuery) {
  const where = segmentWhere(segment, q);
  const countWhere = (seg: CommentListSegment) => segmentWhere(seg, q);
  const [items, all, visible, hidden] = await prisma.$transaction([
    prisma.postComment.findMany({
      where,
      select: {
        id: true,
        postId: true,
        parentId: true,
        userId: true,
        authorName: true,
        content: true,
        status: true,
        wpCommentId: true,
        createdAt: true,
        post: { select: { title: true, slug: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * COMMENT_ADMIN_PAGE_SIZE,
      take: COMMENT_ADMIN_PAGE_SIZE,
    }),
    prisma.postComment.count({ where: countWhere("all") }),
    prisma.postComment.count({ where: countWhere("visible") }),
    prisma.postComment.count({ where: countWhere("hidden") }),
  ]);
  const rows: AdminCommentRow[] = items.map((r) => ({
    id: r.id.toString(),
    postId: r.postId.toString(),
    postTitle: r.post.title,
    postSlug: r.post.slug,
    parentId: r.parentId?.toString() ?? null,
    userId: r.userId?.toString() ?? null,
    authorName: r.authorName,
    content: r.content,
    status: r.status as CommentStatus,
    migrated: r.wpCommentId !== null,
    createdAt: r.createdAt,
    replyCount: 0,
  }));
  // 直接子计数随行(根评论删除连带提示;两级封顶 ⇒ 一次 groupBy 即齐)
  const rootIds = items.filter((r) => r.parentId === null).map((r) => r.id);
  if (rootIds.length > 0) {
    const grouped = await prisma.postComment.groupBy({
      by: ["parentId"],
      where: { parentId: { in: rootIds } },
      _count: { parentId: true },
    });
    const counts = new Map(grouped.map((g) => [g.parentId!.toString(), g._count.parentId]));
    for (const row of rows) row.replyCount = counts.get(row.id) ?? 0;
  }
  return {
    items: rows,
    total: all,
    counts: { all, visible, hidden },
    page,
    segment,
  };
}

/** 流转变更(先发后审:仅 隐藏/恢复,无向序校验——两态互切) */
export async function updateCommentStatus(
  id: bigint,
  status: CommentStatus,
): Promise<AdminCommentRow> {
  const updated = await prisma.postComment.update({
    where: { id },
    data: { status },
    select: {
      id: true,
      postId: true,
      parentId: true,
      userId: true,
      authorName: true,
      content: true,
      status: true,
      wpCommentId: true,
      createdAt: true,
      post: { select: { title: true, slug: true } },
    },
  });
  logger.info({
    event: "comment.status_changed",
    commentId: id.toString(),
    status,
    label: COMMENT_STATUS_LABELS[status],
  });
  return {
    id: updated.id.toString(),
    postId: updated.postId.toString(),
    postTitle: updated.post.title,
    postSlug: updated.post.slug,
    parentId: updated.parentId?.toString() ?? null,
    userId: updated.userId?.toString() ?? null,
    authorName: updated.authorName,
    content: updated.content,
    status: updated.status as CommentStatus,
    migrated: updated.wpCommentId !== null,
    createdAt: updated.createdAt,
    replyCount: 0, // 流转响应不消费该列(行内提示走列表行的实值)
  };
}

/**
 * 物理删除:连带直接子与两点赞表行(两级封顶 ⇒ 收集即完备;点赞表 FK Cascade
 * 会随评论行自动收尸,显式 deleteMany 是为行数对账)。不可逆,Handler 层 confirm。
 */
export async function deleteCommentWithReplies(id: bigint): Promise<{ deleted: number }> {
  const ids = await collectCommentWithReplies(id);
  const deleted = await prisma.$transaction(async (tx) => {
    await tx.postCommentLike.deleteMany({ where: { commentId: { in: ids } } });
    return tx.postComment.deleteMany({ where: { id: { in: ids } } });
  });
  logger.info({
    event: "comment.deleted",
    commentId: id.toString(),
    deleted: deleted.count,
  });
  return { deleted: deleted.count };
}

/** 流转/删除前存在性检查(P2025 统一转业务错误) */
export async function requireComment(id: bigint): Promise<void> {
  const hit = await prisma.postComment.findUnique({ where: { id }, select: { id: true } });
  if (!hit) throw new CommentError("not_found", "评论不存在");
}
