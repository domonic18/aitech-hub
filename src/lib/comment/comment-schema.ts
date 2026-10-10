/**
 * 评论/点赞域 zod 契约(M23):前台提交侧与 admin 流转侧共用同一真相源。
 * 枚举落库英文 slug(role/status 同纪律);先发后审 ⇒ 状态只有 visible/hidden,
 * 无 pending。纯声明零 IO,单测钉行为。
 */
import { z } from "zod";

export const COMMENT_STATUSES = ["visible", "hidden"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const COMMENT_STATUS_LABELS: Record<CommentStatus, string> = {
  visible: "显示",
  hidden: "隐藏",
};

/** 字段边界唯一真相源(前台表单 maxLength 与 service zod 共用,改上限只动这里);
 * 列宽 VarChar(4000) 为容旧站迁移(dry-run 实测 max 2143),新提交收紧到 1000。 */
export const COMMENT_LIMITS = {
  content: { min: 1, max: 1000 },
  authorName: { max: 100 },
  /** 单根评论的回复数钳制(服务端;防单楼被灌) */
  repliesPerRoot: 100,
} as const;

export const COMMENT_PAGE_SIZE = 10;

/** 评论提交入参:纯文字;parentId 仅接受根评论 id(两级封顶,service 校验语义) */
export const commentCreateSchema = z.object({
  content: z.string().trim().min(COMMENT_LIMITS.content.min).max(COMMENT_LIMITS.content.max),
  parentId: z.coerce.number().int().positive().optional(),
});

/** admin 流转入参:隐藏/恢复(先发后审,无 through-pending) */
export const commentStatusSchema = z.object({
  status: z.enum(COMMENT_STATUSES),
});

/** GET 查询入参:分页页码(不合法由 zod 兜底为 1) */
export const commentListQuerySchema = z.object({
  postId: z.coerce.bigint().positive(),
  page: z.coerce.number().int().positive().catch(1),
});

/** 点赞切换入参 */
export const postLikeSchema = z.object({
  postId: z.coerce.bigint().positive(),
});

export const commentLikeSchema = z.object({
  commentId: z.coerce.bigint().positive(),
});
