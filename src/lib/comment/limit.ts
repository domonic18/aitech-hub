/**
 * 评论/点赞限流(M23,Redis INCR+EXPIRE,isOverLimit/recordHit 现成对):
 * 发评 = 用户 10 条/时 + IP 30 条/时(双闸,登录评论的主体是用户号);
 * 点赞 = 身份 60 次/时 + IP 240 次/时(toggle 每击都计,阈值放宽容忍手抖);
 * 评论读 = IP 120 次/分(个人化 liked 现查,防裸刷)。阈值常量不进 env(YAGNI);
 * Redis fail-open 由 isOverLimit 的调用侧 try/catch 兜底(service 统一包)。
 */
import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";

const HOUR_SECONDS = 3600;
const MINUTE_SECONDS = 60;

export const COMMENT_USER_LIMIT = 10;
export const COMMENT_IP_LIMIT = 30;
export const LIKE_IDENTITY_LIMIT = 60;
export const LIKE_IP_LIMIT = 240;
export const COMMENT_LIST_IP_LIMIT = 120;

// ── 桶 key 构造(单测钉格式;键空间与 auth:fail、配额桶互不重叠)──────────

export function commentUserBucket(userId: bigint): string {
  return `comment:u:${userId}`;
}

export function commentIpBucket(ip: string): string {
  return `comment:ip:${ip}`;
}

export function likeIdentityBucket(identityKey: string): string {
  return `like:idt:${identityKey}`;
}

export function likeIpBucket(ip: string): string {
  return `like:ip:${ip}`;
}

export function commentListIpBucket(ip: string): string {
  return `comment:list:ip:${ip}`;
}

// ── 闸判定 + 计数(先判后记;记在动作成功之后,失败不计)──────────────────

export async function commentWriteOverLimit(userId: bigint, ip: string): Promise<boolean> {
  const [u, i] = await Promise.all([
    isOverLimit(commentUserBucket(userId), COMMENT_USER_LIMIT),
    ip ? isOverLimit(commentIpBucket(ip), COMMENT_IP_LIMIT) : Promise.resolve(false),
  ]);
  return u || i;
}

export function recordCommentWrite(userId: bigint, ip: string): Promise<void> {
  return Promise.all([
    recordHit(commentUserBucket(userId), HOUR_SECONDS),
    ...(ip ? [recordHit(commentIpBucket(ip), HOUR_SECONDS)] : []),
  ]).then(() => undefined);
}

export async function likeOverLimit(identityKey: string, ip: string): Promise<boolean> {
  const [i, ipHit] = await Promise.all([
    isOverLimit(likeIdentityBucket(identityKey), LIKE_IDENTITY_LIMIT),
    ip ? isOverLimit(likeIpBucket(ip), LIKE_IP_LIMIT) : Promise.resolve(false),
  ]);
  return i || ipHit;
}

export function recordLikeHit(identityKey: string, ip: string): Promise<void> {
  return Promise.all([
    recordHit(likeIdentityBucket(identityKey), HOUR_SECONDS),
    ...(ip ? [recordHit(likeIpBucket(ip), HOUR_SECONDS)] : []),
  ]).then(() => undefined);
}

export function commentListOverLimit(ip: string): Promise<boolean> {
  return ip ? isOverLimit(commentListIpBucket(ip), COMMENT_LIST_IP_LIMIT) : Promise.resolve(false);
}

export function recordCommentListHit(ip: string): Promise<void> {
  return ip ? recordHit(commentListIpBucket(ip), MINUTE_SECONDS) : Promise.resolve();
}
