/**
 * 评论域 zod 契约单测(M23 批①):值域/边界/可选语义钉死——前台表单与
 * service 共用本真相源,改边界必须在这里先红。
 */
import { describe, expect, it } from "vitest";

import {
  COMMENT_LIMITS,
  COMMENT_PAGE_SIZE,
  COMMENT_STATUS_LABELS,
  COMMENT_STATUSES,
  commentCreateSchema,
  commentListQuerySchema,
  commentStatusSchema,
  commentLikeSchema,
  postLikeSchema,
} from "./comment-schema";

describe("commentCreateSchema(发评入参)", () => {
  it("合法提交通过,trim 落库;无 parentId 回文章", () => {
    const out = commentCreateSchema.parse({ content: "  写得很清楚,收藏了  " });
    expect(out.content).toBe("写得很清楚,收藏了");
    expect(out.parentId).toBeUndefined();
  });

  it("parentId 接受数字字符串(coerce bigint 出参前用)", () => {
    expect(commentCreateSchema.parse({ content: "赞", parentId: "42" }).parentId).toBe(42);
  });

  it("content 空串/纯空白 / 超 1000 拒绝", () => {
    expect(() => commentCreateSchema.parse({ content: "" })).toThrow();
    expect(() => commentCreateSchema.parse({ content: "   \n  " })).toThrow();
    expect(() =>
      commentCreateSchema.parse({ content: "评".repeat(COMMENT_LIMITS.content.max + 1) }),
    ).toThrow();
  });

  it("边界:1 码点与恰好 1000 码点放行", () => {
    expect(commentCreateSchema.parse({ content: "好" }).content).toBe("好");
    const max = commentCreateSchema.parse({ content: "评".repeat(COMMENT_LIMITS.content.max) });
    expect(max.content).toHaveLength(COMMENT_LIMITS.content.max);
  });

  it("parentId 非正整数拒绝", () => {
    expect(() => commentCreateSchema.parse({ content: "回复", parentId: 0 })).toThrow();
    expect(() => commentCreateSchema.parse({ content: "回复", parentId: -1 })).toThrow();
    expect(() => commentCreateSchema.parse({ content: "回复", parentId: "abc" })).toThrow();
  });
});

describe("commentStatusSchema / 标签(admin 流转)", () => {
  it("两态合法(先发后审,无 pending);非法值拒绝", () => {
    for (const s of COMMENT_STATUSES) {
      expect(COMMENT_STATUS_LABELS[s]).toBeTruthy();
      expect(commentStatusSchema.parse({ status: s }).status).toBe(s);
    }
    expect(COMMENT_STATUSES).not.toContain("pending");
    expect(() => commentStatusSchema.parse({ status: "review" })).toThrow();
  });
});

describe("查询/点赞入参", () => {
  it("postId/coerce 合法;page 缺省兜底 1;非法 page 兜底 1", () => {
    expect(commentListQuerySchema.parse({ postId: "12" }).postId).toBe(BigInt(12));
    expect(commentListQuerySchema.parse({ postId: "12" }).page).toBe(1);
    expect(commentListQuerySchema.parse({ postId: "12", page: "abc" }).page).toBe(1);
    expect(COMMENT_PAGE_SIZE).toBe(10);
  });

  it("点赞入参 bigint 化;非正数拒绝", () => {
    expect(postLikeSchema.parse({ postId: "7" }).postId).toBe(BigInt(7));
    expect(commentLikeSchema.parse({ commentId: 9 }).commentId).toBe(BigInt(9));
    expect(() => postLikeSchema.parse({ postId: "0" })).toThrow();
  });
});
