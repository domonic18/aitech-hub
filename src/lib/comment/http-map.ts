/**
 * 评论/点赞业务错误 → HTTP 状态映射(M23):Route Handler 共用,防三路由
 * 各写一套 switch 漂移。纯函数,无 next 依赖。
 */
import type { CommentErrorCode } from "./comment-service";
import type { LikeErrorCode } from "./like-service";

const COMMENT_STATUS: Record<CommentErrorCode, number> = {
  not_found: 404,
  invalid_parent: 400,
  blocked_word: 400,
  rate_limited: 429,
};

const LIKE_STATUS: Record<LikeErrorCode, number> = {
  not_found: 404,
  rate_limited: 429,
};

/** 业务错误返回 HTTP 状态码;非域内错误返回 null(调用方重抛) */
export function commentDomainErrorStatus(e: unknown): number | null {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as { code: string }).code;
    if (c in COMMENT_STATUS) return COMMENT_STATUS[c as CommentErrorCode];
    if (c in LIKE_STATUS) return LIKE_STATUS[c as LikeErrorCode];
  }
  return null;
}
