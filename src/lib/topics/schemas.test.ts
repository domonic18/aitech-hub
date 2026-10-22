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

  it("主意图(M42):article/pin 合法,缺省不落键,非法值拒绝", () => {
    expect(topicCreateSchema.safeParse({ title: "t", outputType: "pin" }).success).toBe(true);
    expect(topicCreateSchema.safeParse({ title: "t", outputType: "article" }).success).toBe(true);
    expect(topicCreateSchema.safeParse({ title: "t", outputType: "video" }).success).toBe(false);
    const parsed = topicCreateSchema.parse({ title: "t" });
    expect(parsed.outputType).toBeUndefined();
  });
});

describe("topicUpdateSchema", () => {
  it("空对象拒绝;linkedPostId 可空可置数字串", () => {
    expect(topicUpdateSchema.safeParse({}).success).toBe(false);
    expect(topicUpdateSchema.safeParse({ linkedPostId: "123" }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ linkedPostId: null }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ linkedPostId: "12a" }).success).toBe(false);
  });

  it("skillKey(M30 批②):合法 key / 解绑 null;大写与非法字符拒绝", () => {
    expect(topicUpdateSchema.safeParse({ skillKey: "blogger-video" }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ skillKey: null }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ skillKey: "Blogger" }).success).toBe(false);
    expect(topicUpdateSchema.safeParse({ skillKey: "-lead" }).success).toBe(false);
    expect(topicUpdateSchema.safeParse({ skillKey: " " }).success).toBe(false);
  });

  it("sampleImageId(M39 批③):数字串 / 解绑 null;非数字拒绝", () => {
    expect(topicUpdateSchema.safeParse({ sampleImageId: "42" }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ sampleImageId: null }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ sampleImageId: "4a" }).success).toBe(false);
    expect(topicUpdateSchema.safeParse({ sampleImageId: 42 }).success).toBe(false);
  });

  it("贴图配置(M42):≤1000 码点,可置空;主意图可切换", () => {
    expect(topicUpdateSchema.safeParse({ pinPositioning: "画面:共 6 张" }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ pinPositioning: null }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ pinPositioning: "x".repeat(1001) }).success).toBe(false);
    expect(topicUpdateSchema.safeParse({ outputType: "pin" }).success).toBe(true);
    expect(topicUpdateSchema.safeParse({ outputType: "audio" }).success).toBe(false);
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
