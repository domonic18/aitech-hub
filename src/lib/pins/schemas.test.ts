/**
 * 贴图域契约单测(纯 Zod,零 mock):码点计数口径(代理对不虚增/不漏判)、
 * 三通道添加图 union 形态、标题/轻文字上限与公众号 newspic 契约对齐。
 */
import { describe, expect, it } from "vitest";

import { PIN_IMAGES_MAX, PIN_TITLE_MAX } from "./constants";
import {
  pinCreateSchema,
  pinGenerateSchema,
  pinImageAddSchema,
  pinImageReorderSchema,
  pinStatusSchema,
  pinUpdateSchema,
} from "./schemas";

describe("标题码点上限(公众号 32 字)", () => {
  it(`${PIN_TITLE_MAX} 个 CJK 码点过,超一字拒`, () => {
    expect(pinCreateSchema.safeParse({ title: "贴".repeat(PIN_TITLE_MAX) }).success).toBe(true);
    expect(pinCreateSchema.safeParse({ title: "贴".repeat(PIN_TITLE_MAX + 1) }).success).toBe(
      false,
    );
  });

  it("代理对按 1 码点计:32 个 emoji 过(UTF-16 count 会是 64)", () => {
    expect(pinCreateSchema.safeParse({ title: "🤖".repeat(PIN_TITLE_MAX) }).success).toBe(true);
  });

  it("标题 trim 后非空约束", () => {
    expect(pinCreateSchema.safeParse({ title: "   " }).success).toBe(false);
  });
});

describe("轻文字码点硬上限(2 万)", () => {
  it("超 20000 码点拒", () => {
    expect(pinUpdateSchema.safeParse({ content: "字".repeat(20001) }).success).toBe(false);
  });

  it("10001 个代理对 emoji = 10001 码点 < 20000,过(按 UTF-16 会误拒)", () => {
    expect(pinUpdateSchema.safeParse({ content: "🤖".repeat(10001) }).success).toBe(true);
  });
});

describe("其它字段约束", () => {
  it("阅读原文须 http(s) 完整链接,可空", () => {
    expect(
      pinCreateSchema.safeParse({ title: "t", readMoreUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
    expect(pinCreateSchema.safeParse({ title: "t", readMoreUrl: null }).success).toBe(true);
  });

  it("cropSpec 只认三档", () => {
    expect(pinUpdateSchema.safeParse({ cropSpec: "1_1" }).success).toBe(true);
    expect(pinUpdateSchema.safeParse({ cropSpec: "4_3" }).success).toBe(false);
  });

  it("update 至少一个字段;status 独立 schema 四态", () => {
    expect(pinUpdateSchema.safeParse({}).success).toBe(false);
    expect(pinStatusSchema.safeParse({ status: "pending" }).success).toBe(true);
    expect(pinStatusSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});

describe("添加图 union(工坊版本 | 本地上传)", () => {
  it("versionIds 形态:空数组拒,上限对齐序列 20", () => {
    expect(pinImageAddSchema.safeParse({ versionIds: [] }).success).toBe(false);
    expect(
      pinImageAddSchema.safeParse({
        versionIds: Array.from({ length: PIN_IMAGES_MAX }, (_, i) => String(i + 1)),
      }).success,
    ).toBe(true);
    expect(
      pinImageAddSchema.safeParse({
        versionIds: Array.from({ length: PIN_IMAGES_MAX + 1 }, (_, i) => String(i + 1)),
      }).success,
    ).toBe(false);
  });

  it("本地上传形态:mediaPath 必填,宽高为正整数可选", () => {
    expect(pinImageAddSchema.safeParse({ mediaPath: "/wp/a.webp" }).success).toBe(true);
    expect(pinImageAddSchema.safeParse({ mediaPath: "/wp/a.webp", width: 0 }).success).toBe(false);
    expect(pinImageAddSchema.safeParse({ width: 100 }).success).toBe(false);
  });

  it("重排:ids 有序数组同上限", () => {
    expect(pinImageReorderSchema.safeParse({ ids: ["1", "2"] }).success).toBe(true);
    expect(pinImageReorderSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

describe("生成入参(illustrate 通道)", () => {
  it("prompt 必填 ≤2000;count 1..3;aspect 可选", () => {
    expect(pinGenerateSchema.safeParse({ prompt: "画一张" }).success).toBe(true);
    expect(pinGenerateSchema.safeParse({}).success).toBe(false);
    expect(pinGenerateSchema.safeParse({ prompt: "x", count: 4 }).success).toBe(false);
    expect(pinGenerateSchema.safeParse({ prompt: "x", aspect: "3:4", count: 3 }).success).toBe(
      true,
    );
  });
});
