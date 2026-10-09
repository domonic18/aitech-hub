/**
 * 反馈域 zod 契约单测(M22 批①):值域/边界/可选语义钉死——工具面与 admin
 * 表单共用本真相源,改边界必须在这里先红。
 */
import { describe, expect, it } from "vitest";

import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_LIMITS,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_STATUSES,
  feedbackUpdateSchema,
  submitFeedbackSchema,
} from "./feedback-schema";

describe("submitFeedbackSchema(助手工具入参)", () => {
  it("合法提交通过(仅必填项)", () => {
    const out = submitFeedbackSchema.parse({ category: "issue", content: "页面打不开了" });
    expect(out.category).toBe("issue");
    expect(out.contact).toBeUndefined();
  });

  it("contact 可选但超长拒绝", () => {
    const ok = submitFeedbackSchema.parse({
      category: "requirement",
      content: "希望支持导出功能",
      contact: "  wx: abc123  ",
    });
    expect(ok.contact).toBe("wx: abc123"); // trim 落库口径
    expect(() =>
      submitFeedbackSchema.parse({
        category: "other",
        content: "随便说说",
        contact: "c".repeat(FEEDBACK_LIMITS.contact.max + 1),
      }),
    ).toThrow();
  });

  it("category 值域外的 slug 拒绝", () => {
    expect(() => submitFeedbackSchema.parse({ category: "complaint", content: "你好" })).toThrow();
    for (const c of FEEDBACK_CATEGORIES) {
      expect(FEEDBACK_CATEGORY_LABELS[c]).toBeTruthy();
    }
  });

  it("content 不足 5 码点 / 超 2000 拒绝", () => {
    expect(() => submitFeedbackSchema.parse({ category: "other", content: "短" })).toThrow();
    expect(() =>
      submitFeedbackSchema.parse({
        category: "other",
        content: "长".repeat(FEEDBACK_LIMITS.content.max + 1),
      }),
    ).toThrow();
  });
});

describe("feedbackUpdateSchema(admin 流转入参)", () => {
  it("三状态合法流转 + 备注可选", () => {
    for (const s of FEEDBACK_STATUSES) {
      expect(FEEDBACK_STATUS_LABELS[s]).toBeTruthy();
      expect(feedbackUpdateSchema.parse({ status: s }).status).toBe(s);
    }
    expect(
      feedbackUpdateSchema.parse({ status: "processing", adminNote: " 已联系用户 " }).adminNote,
    ).toBe("已联系用户");
  });

  it("非法状态 / 超长备注拒绝", () => {
    expect(() => feedbackUpdateSchema.parse({ status: "closed" })).toThrow();
    expect(() =>
      feedbackUpdateSchema.parse({
        status: "open",
        adminNote: "n".repeat(FEEDBACK_LIMITS.adminNote.max + 1),
      }),
    ).toThrow();
  });
});
