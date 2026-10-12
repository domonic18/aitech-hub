/**
 * 专题域 Zod 契约单测(M26 批①):边界与 BigInt id 口径。
 */
import { describe, expect, it } from "vitest";

import { itemMountSchema, itemUpdateSchema, topicCreateSchema, topicUpdateSchema } from "./schemas";

describe("topicCreateSchema", () => {
  it("标题必填且 ≤200;定位可选", () => {
    expect(topicCreateSchema.safeParse({ title: "Agent 工具对比" }).success).toBe(true);
    expect(topicCreateSchema.safeParse({ title: "x".repeat(201) }).success).toBe(false);
    expect(topicCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe("topicUpdateSchema", () => {
  it("空对象拒绝;linkedPostId 可空可置数字串", () => {
    expect(topicUpdateSchema.safeParse({}).success).toBe(false);
    expect(topicUpdateSchema.safeParse({ linkedPostId: "123" }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ linkedPostId: null }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ linkedPostId: "12a" }).success).toBe(false);
  });
});

describe("itemMountSchema", () => {
  it("itemType 枚举 + itemId 纯数字 + note ≤500", () => {
    expect(
      itemMountSchema.safeParse({ itemType: "telegram", itemId: "42", note: "重点用第 2 点" })
        .success,
    ).toBe(true);
    expect(itemMountSchema.safeParse({ itemType: "video", itemId: "42" }).success).toBe(false);
    expect(itemMountSchema.safeParse({ itemType: "post", itemId: "-1" }).success).toBe(false);
    expect(
      itemMountSchema.safeParse({ itemType: "post", itemId: "1", note: "x".repeat(501) }).success,
    ).toBe(false);
  });
});

describe("itemUpdateSchema", () => {
  it("空对象拒绝;sortOrder 非负整数", () => {
    expect(itemUpdateSchema.safeParse({}).success).toBe(false);
    expect(itemUpdateSchema.safeParse({ sortOrder: 0 }).success).toBe(true);
    expect(itemUpdateSchema.safeParse({ sortOrder: -1 }).success).toBe(false);
    expect(itemUpdateSchema.safeParse({ note: null }).success).toBe(true);
  });
});
