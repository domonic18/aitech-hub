/**
 * 榜单 meta 单测(M63):写侧白名单清洗 + 读侧宽容退化。
 * 红线:历史行(meta 只有 url,或干脆是脏数据)必须读出 `extra:{}` 而不是抛错;
 * 数值字段只要非有限或负数一律丢弃;文本按上限截断。
 */
import { describe, expect, it } from "vitest";

import {
  META_AUTHORS_MAX,
  META_CATEGORIES_MAX,
  META_DESCRIPTION_MAX,
  META_SUMMARY_MAX,
  normalizeExtra,
  readSnapshotMeta,
  snapshotMeta,
} from "./meta";

describe("normalizeExtra", () => {
  it("保留已知字段并按类型清洗", () => {
    const out = normalizeExtra({
      price1mOutputTokens: 15,
      contextWindowTokens: 200_000,
      isOpenWeights: true,
      pipelineTag: "text-generation",
      publishedAt: "2026-10-30",
      stars: 1234,
      unknownKey: "drop",
    });
    expect(out).toEqual({
      price1mOutputTokens: 15,
      contextWindowTokens: 200_000,
      isOpenWeights: true,
      pipelineTag: "text-generation",
      publishedAt: "2026-10-30",
      stars: 1234,
    });
  });

  it("非对象/字符串/数组/null → undefined", () => {
    expect(normalizeExtra(null)).toBeUndefined();
    expect(normalizeExtra("url")).toBeUndefined();
    expect(normalizeExtra(["a"])).toBeUndefined();
    expect(normalizeExtra(42)).toBeUndefined();
    expect(normalizeExtra(undefined)).toBeUndefined();
  });

  it("全为空对象/空串/空数组 → undefined(不让空 extra 落库)", () => {
    expect(normalizeExtra({})).toBeUndefined();
    expect(normalizeExtra({ summary: "   ", authors: [], categories: [] })).toBeUndefined();
    expect(normalizeExtra({ pipelineTag: "" })).toBeUndefined();
  });

  it("数字:NaN/Infinity/负数/字符串一律丢弃", () => {
    const out = normalizeExtra({
      price1mOutputTokens: Number.NaN,
      price1mInputTokens: Number.POSITIVE_INFINITY,
      stars: -1,
      forks: "12",
      likes: 0,
    });
    expect(out).toEqual({ likes: 0 });
  });

  it("布尔字段只接受真布尔", () => {
    expect(normalizeExtra({ isReasoning: "true" })).toBeUndefined();
    expect(normalizeExtra({ isReasoning: false })).toEqual({ isReasoning: false });
  });

  it("摘要/描述超长截断;作者去重截到上限;分类截到上限", () => {
    const out = normalizeExtra({
      summary: "长".repeat(META_SUMMARY_MAX + 50),
      description: "d".repeat(META_DESCRIPTION_MAX + 50),
      authors: Array.from({ length: META_AUTHORS_MAX + 5 }, (_, i) => `作者${i}`).concat("作者0"),
      categories: Array.from({ length: META_CATEGORIES_MAX + 3 }, (_, i) => `cs.X${i}`),
    });
    expect(out?.summary).toHaveLength(META_SUMMARY_MAX);
    expect(out?.description).toHaveLength(META_DESCRIPTION_MAX);
    expect(out?.authors).toHaveLength(META_AUTHORS_MAX);
    expect(new Set(out?.authors).size).toBe(out?.authors?.length);
    expect(out?.categories).toHaveLength(META_CATEGORIES_MAX);
  });

  it("超长单字符串按 64 截断(只留短标识字段)", () => {
    const out = normalizeExtra({ language: "x".repeat(100) });
    expect(out?.language).toHaveLength(64);
  });
});

describe("snapshotMeta", () => {
  it("写侧合并 url + sourceId + 已清洗字段,不含 undefined 键", () => {
    const meta = snapshotMeta("https://example.com/m", 7, {
      price1mOutputTokens: 3,
      summary: undefined,
      stars: Number.NaN,
    });
    expect(meta).toEqual({ url: "https://example.com/m", sourceId: 7, price1mOutputTokens: 3 });
    expect(Object.values(meta).every((v) => v !== undefined)).toBe(true);
  });

  it("无 extra 时只落 url + sourceId(历史形态)", () => {
    expect(snapshotMeta("https://example.com/m", 7)).toEqual({
      url: "https://example.com/m",
      sourceId: 7,
    });
  });
});

describe("readSnapshotMeta", () => {
  it("历史行只有 url:url 保留,extra 为空对象", () => {
    expect(readSnapshotMeta({ url: "https://example.com/m", sourceId: 7 })).toEqual({
      url: "https://example.com/m",
      extra: {},
    });
  });

  it("脏数据(null/字符串/数组/缺 url)永不抛错", () => {
    expect(readSnapshotMeta(null)).toEqual({ url: "", extra: {} });
    expect(readSnapshotMeta("oops")).toEqual({ url: "", extra: {} });
    expect(readSnapshotMeta([1, 2])).toEqual({ url: "", extra: {} });
    expect(readSnapshotMeta(undefined)).toEqual({ url: "", extra: {} });
    expect(readSnapshotMeta({ url: 123 })).toEqual({ url: "", extra: {} });
    expect(readSnapshotMeta({ extra: { stars: 1 } })).toEqual({ url: "", extra: {} });
  });

  it("读侧与写侧同规则:非法数值/未知键在读出时被清洗", () => {
    const read = readSnapshotMeta({ url: "u", price1mOutputTokens: -5, foo: "bar", stars: 9 });
    expect(read.extra).toEqual({ stars: 9 });
  });
});
