/**
 * 反馈域 zod 契约(M22 批①,需求7/9):提交侧(助手 submit_feedback 工具)
 * 与 admin 流转侧共用同一真相源;枚举值落库为英文 slug(同 role/status 纪律),
 * 中文标签供 UI/工具面展示。纯声明零 IO,单测钉行为。
 */
import { z } from "zod";

export const FEEDBACK_CATEGORIES = ["requirement", "issue", "suggestion", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  requirement: "需求",
  issue: "问题",
  suggestion: "建议",
  other: "其他",
};

export const FEEDBACK_STATUSES = ["open", "processing", "resolved"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "待处理",
  processing: "处理中",
  resolved: "已解决",
};

/** 字段边界唯一真相源(工具面 zod 与 admin 表单共用,改上限只动这里) */
export const FEEDBACK_LIMITS = {
  content: { min: 5, max: 2000 },
  contact: { max: 200 },
  adminNote: { max: 500 },
} as const;

/** 助手 submit_feedback 工具入参:contact 用户自愿留(对话内询问,可拒) */
export const submitFeedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  content: z.string().trim().min(FEEDBACK_LIMITS.content.min).max(FEEDBACK_LIMITS.content.max),
  contact: z.string().trim().max(FEEDBACK_LIMITS.contact.max).optional(),
});

/** admin 流转入参:状态机 open → processing → resolved + 处理备注 */
export const feedbackUpdateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES),
  adminNote: z.string().trim().max(FEEDBACK_LIMITS.adminNote.max).optional(),
});
