/**
 * 评论公开读 + 写(M23):GET 分页(根 desc / 子 asc,个人化 liked 现判)+
 * 登录发评(先发后审:status=visible 即时可见;屏蔽词 + 双闸限流把门)。
 * 软删/下架文章一律 not_found(评论区随文消失,数据保留)。BigInt 出参
 * 字符串化在本文件序列化层完成,路由零转换。
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import type { BlocklistWord, FilterHit } from "@/lib/telegram/filter";
import { BLOCKLIST_SCOPE_ALL, BLOCKLIST_SCOPE_COMMENT } from "@/lib/telegram/constants";

import { matchCommentBlocklist } from "./comment-filter";
import { COMMENT_LIMITS, COMMENT_PAGE_SIZE, type CommentStatus } from "./comment-schema";
import {
  commentListOverLimit,
  commentWriteOverLimit,
  recordCommentListHit,
  recordCommentWrite,
} from "./limit";

/** 业务错误 → Handler 按码映射 HTTP 状态(FeedbackAdminError 同款) */
export type CommentErrorCode = "not_found" | "invalid_parent" | "blocked_word" | "rate_limited";

export class CommentError extends Error {
  constructor(
    public code: CommentErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 评论树节点(子层 replies 仅根节点携带;二级封顶,子节点不再有 replies) */
export interface CommentDto {
  id: string;
  postId: string;
  parentId: string | null;
  authorName: string;
  content: string;
  status: CommentStatus;
  /** 迁移标记:来自旧站 wp_comments(展示「WP 迁移」徽标用) */
  migrated: boolean;
  createdAt: string;
  likeCount: number;
  liked: boolean;
  replies?: CommentDto[];
}

export interface CommentListResult {
  items: CommentDto[];
  page: number;
  pageSize: number;
  /** 根评论总数(分页口径,不含回复) */
  total: number;
  hasMore: boolean;
}

const COMMENT_LIST_SELECT = {
  id: true,
  postId: true,
  parentId: true,
  authorName: true,
  content: true,
  status: true,
  wpCommentId: true,
  createdAt: true,
} as const;

/** 文可评判定:仅 published(软删/草稿/下架一律不可见评论区) */
async function requirePublishedPost(postId: bigint): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { status: true },
  });
  if (!post || post.status !== "published")
    throw new CommentError("not_found", "文章不存在或未发布");
}

function toDto(
  row: {
    id: bigint;
    postId: bigint;
    parentId: bigint | null;
    authorName: string;
    content: string;
    status: string;
    wpCommentId: bigint | null;
    createdAt: Date;
  },
  likeCount: number,
  liked: boolean,
): CommentDto {
  return {
    id: row.id.toString(),
    postId: row.postId.toString(),
    parentId: row.parentId?.toString() ?? null,
    authorName: row.authorName,
    content: row.content,
    status: row.status as CommentStatus,
    migrated: row.wpCommentId !== null,
    createdAt: row.createdAt.toISOString(),
    likeCount,
    liked,
  };
}

/** 点赞计数 map(commentId → count;一次 groupBy,防 N+1) */
async function likeCounts(ids: bigint[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const grouped = await prisma.postCommentLike.groupBy({
    by: ["commentId"],
    where: { commentId: { in: ids } },
    _count: { commentId: true },
  });
  return new Map(grouped.map((g) => [g.commentId.toString(), g._count.commentId]));
}

/** 当前身份已赞集合(一次查询;游客无 identityKey 时恒空) */
async function likedIds(ids: bigint[], identityKey: string | null): Promise<Set<string>> {
  if (identityKey === null || ids.length === 0) return new Set();
  const rows = await prisma.postCommentLike.findMany({
    where: { commentId: { in: ids }, identityKey },
    select: { commentId: true },
  });
  return new Set(rows.map((r) => r.commentId.toString()));
}

/**
 * 评论列表:status=visible,根评论 createdAt desc 分页(页 10),子评论 asc
 * 随根整楼返回(单根服务端钳 ≤100)。likeCount/liked 对楼内全部节点现查。
 */
export async function listPostComments(
  postId: bigint,
  page: number,
  identityKey: string | null,
): Promise<CommentListResult> {
  await requirePublishedPost(postId);
  const where = { postId, status: "visible", parentId: null };
  const [roots, total] = await Promise.all([
    prisma.postComment.findMany({
      where,
      select: COMMENT_LIST_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * COMMENT_PAGE_SIZE,
      take: COMMENT_PAGE_SIZE,
    }),
    prisma.postComment.count({ where }),
  ]);
  const rootIds = roots.map((r) => r.id);
  const replies =
    rootIds.length === 0
      ? []
      : await prisma.postComment.findMany({
          where: { postId, status: "visible", parentId: { in: rootIds } },
          select: COMMENT_LIST_SELECT,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: rootIds.length * COMMENT_LIMITS.repliesPerRoot,
        });
  const allIds = [...rootIds, ...replies.map((r) => r.id)];
  const [counts, liked] = await Promise.all([likeCounts(allIds), likedIds(allIds, identityKey)]);
  const repliesByRoot = new Map<string, CommentDto[]>();
  for (const r of replies) {
    const key = r.parentId!.toString();
    const arr = repliesByRoot.get(key) ?? [];
    arr.push(toDto(r, counts.get(r.id.toString()) ?? 0, liked.has(r.id.toString())));
    repliesByRoot.set(key, arr);
  }
  const items = roots.map((r) => ({
    ...toDto(r, counts.get(r.id.toString()) ?? 0, liked.has(r.id.toString())),
    replies: repliesByRoot.get(r.id.toString()) ?? [],
  }));
  return {
    items,
    page,
    pageSize: COMMENT_PAGE_SIZE,
    total,
    hasMore: page * COMMENT_PAGE_SIZE < total,
  };
}

/** 读侧限流(个人化现查防裸刷;IP 空=本机调试不进桶) */
export async function guardCommentList(ip: string): Promise<void> {
  if (await commentListOverLimit(ip)) throw new CommentError("rate_limited", "请求过于频繁");
  await recordCommentListHit(ip);
}

/**
 * 登录发评(先发后审):文 published → 父校验(同文+visible+父为根,两级封顶)
 * → 屏蔽词 → 双闸限流 → create(status=visible) 即时可见。
 */
export async function createPostComment(input: {
  postId: bigint;
  userId: bigint;
  authorName: string;
  content: string;
  parentId?: bigint;
  ip: string;
}): Promise<CommentDto> {
  await requirePublishedPost(input.postId);
  if (input.parentId !== undefined) {
    const parent = await prisma.postComment.findUnique({
      where: { id: input.parentId },
      select: { postId: true, status: true, parentId: true },
    });
    if (
      !parent ||
      parent.postId !== input.postId ||
      parent.status !== "visible" ||
      parent.parentId !== null
    ) {
      throw new CommentError("invalid_parent", "回复目标不存在或不可回复");
    }
  }
  const words = (await prisma.blocklist.findMany({
    where: { enabled: true, scope: { in: [BLOCKLIST_SCOPE_COMMENT, BLOCKLIST_SCOPE_ALL] } },
    select: { word: true, scope: true },
  })) as BlocklistWord[];
  const hit: FilterHit | null = matchCommentBlocklist(input.content, words);
  if (hit) {
    logger.info({ event: "comment.blocked_word", postId: input.postId.toString(), rule: hit.rule });
    throw new CommentError("blocked_word", "评论包含不允许的内容");
  }
  if (await commentWriteOverLimit(input.userId, input.ip)) {
    throw new CommentError("rate_limited", "操作过于频繁,请稍后再试");
  }
  const created = await prisma.postComment.create({
    data: {
      postId: input.postId,
      userId: input.userId,
      authorName: input.authorName,
      content: input.content,
      status: "visible",
      parentId: input.parentId ?? null,
    },
    select: COMMENT_LIST_SELECT,
  });
  logger.info({
    event: "comment.created",
    commentId: created.id.toString(),
    postId: input.postId.toString(),
    userId: input.userId.toString(),
    reply: input.parentId !== undefined,
  });
  await recordCommentWrite(input.userId, input.ip);
  return toDto(created, 0, false);
}

// ── admin 治理读侧辅助(路由与 /admin/comments 页共用)─────────────────────

/** 评论及其直接子 id(删根连带;两级封顶 ⇒ 收集即完备) */
export async function collectCommentWithReplies(id: bigint): Promise<bigint[]> {
  const [self, replies] = await Promise.all([
    prisma.postComment.findUnique({ where: { id }, select: { id: true } }),
    prisma.postComment.findMany({ where: { parentId: id }, select: { id: true } }),
  ]);
  if (!self) throw new CommentError("not_found", "评论不存在");
  return [self.id, ...replies.map((r) => r.id)];
}
