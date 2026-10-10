/**
 * 点赞域(M23):文章/评论同构 toggle(identityKey 单列去重)。identityKey:
 * "u:<userId>"(登录含 admin,同为人账号一行一赞)| "v:<ah_av uuid>"(游客)。
 * 计数现查 COUNT,不加冗余列。toggle 取「先删后建」而非事务内 catch P2002
 * 再删——PG 唯一冲突即中止事务,同事务续行必 25P02;先删后建各语句自洽,
 * 并发同击收敛为单行(唯一约束兜底),语义=意图归并。已知边界:游客首赞
 * 双击各持新 uuid 理论可双赞——按钮 busy 防抖 + IP 闸兜底。
 */
import { prisma, isP2002 } from "@/lib/db";
import { logger } from "@/lib/logger";

import type { AgentIdentity } from "@/lib/agent/identity";

import { likeOverLimit, recordLikeHit } from "./limit";

export type LikeErrorCode = "not_found" | "rate_limited";

export class LikeError extends Error {
  constructor(
    public code: LikeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface LikeState {
  liked: boolean;
  count: number;
}

/** 身份 → 去重键(admin/user 同落 "u:" 空间——同一 user_account 一行一赞) */
export function buildIdentityKey(identity: AgentIdentity): string {
  if (identity.kind === "guest") return `v:${identity.key}`;
  if (identity.kind === "admin") return `u:${identity.key.slice("admin:".length)}`;
  return `u:${identity.key.slice("user:".length)}`;
}

async function assertNotRateLimited(identityKey: string, ip: string): Promise<void> {
  if (await likeOverLimit(identityKey, ip)) {
    throw new LikeError("rate_limited", "操作过于频繁,请稍后再试");
  }
}

/** 文章点赞切换;文须 published(软删/下架/草稿一律 404,评论区随文消失) */
export async function togglePostLike(
  postId: bigint,
  identity: AgentIdentity,
  ip: string,
): Promise<LikeState> {
  const identityKey = buildIdentityKey(identity);
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { status: true } });
  if (!post || post.status !== "published") throw new LikeError("not_found", "文章不存在或未发布");
  await assertNotRateLimited(identityKey, ip);
  const state = await (async (): Promise<{ liked: boolean }> => {
    const gone = await prisma.postLike.deleteMany({ where: { postId, identityKey } });
    if (gone.count > 0) return { liked: false };
    try {
      await prisma.postLike.create({ data: { postId, identityKey } });
      return { liked: true };
    } catch (e) {
      if (!isP2002(e)) throw e;
      return { liked: true }; // 并发对手已建行,同为「赞」意图
    }
  })();
  const count = await prisma.postLike.count({ where: { postId } });
  logger.info({
    event: "post_like.toggled",
    postId: postId.toString(),
    identityKey,
    liked: state.liked,
  });
  await recordLikeHit(identityKey, ip);
  return { liked: state.liked, count };
}

/** 评论点赞切换;评论须 visible 且其文 published */
export async function toggleCommentLike(
  commentId: bigint,
  identity: AgentIdentity,
  ip: string,
): Promise<LikeState> {
  const identityKey = buildIdentityKey(identity);
  const comment = await prisma.postComment.findUnique({
    where: { id: commentId },
    select: { status: true, post: { select: { status: true } } },
  });
  if (!comment || comment.status !== "visible" || comment.post.status !== "published") {
    throw new LikeError("not_found", "评论不存在");
  }
  await assertNotRateLimited(identityKey, ip);
  const state = await (async (): Promise<{ liked: boolean }> => {
    const gone = await prisma.postCommentLike.deleteMany({ where: { commentId, identityKey } });
    if (gone.count > 0) return { liked: false };
    try {
      await prisma.postCommentLike.create({ data: { commentId, identityKey } });
      return { liked: true };
    } catch (e) {
      if (!isP2002(e)) throw e;
      return { liked: true }; // 并发对手已建行,同为「赞」意图
    }
  })();
  const count = await prisma.postCommentLike.count({ where: { commentId } });
  logger.info({
    event: "comment_like.toggled",
    commentId: commentId.toString(),
    identityKey,
    liked: state.liked,
  });
  await recordLikeHit(identityKey, ip);
  return { liked: state.liked, count };
}

/** 文章点赞态查询(按钮初始化;文不可见时 404,按钮不渲染) */
export async function getPostLikeState(
  postId: bigint,
  identity: AgentIdentity,
): Promise<LikeState> {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { status: true } });
  if (!post || post.status !== "published") throw new LikeError("not_found", "文章不存在或未发布");
  return postLikeState(postId, buildIdentityKey(identity));
}

/** 评论点赞态查询(评论须 visible 且文 published) */
export async function getCommentLikeState(
  commentId: bigint,
  identity: AgentIdentity,
): Promise<LikeState> {
  const identityKey = buildIdentityKey(identity);
  const comment = await prisma.postComment.findUnique({
    where: { id: commentId },
    select: { status: true, post: { select: { status: true } } },
  });
  if (!comment || comment.status !== "visible" || comment.post.status !== "published") {
    throw new LikeError("not_found", "评论不存在");
  }
  return commentLikeState(commentId, identityKey);
}

// ── 内部:状态现查(toggle 与 get 共用)────────────────────────────────────

async function postLikeState(postId: bigint, identityKey: string): Promise<LikeState> {
  const [liked, count] = await Promise.all([
    prisma.postLike.findUnique({
      where: { postId_identityKey: { postId, identityKey } },
      select: { postId: true },
    }),
    prisma.postLike.count({ where: { postId } }),
  ]);
  return { liked: liked !== null, count };
}

async function commentLikeState(commentId: bigint, identityKey: string): Promise<LikeState> {
  const [liked, count] = await Promise.all([
    prisma.postCommentLike.findUnique({
      where: { commentId_identityKey: { commentId, identityKey } },
      select: { commentId: true },
    }),
    prisma.postCommentLike.count({ where: { commentId } }),
  ]);
  return { liked: liked !== null, count };
}
