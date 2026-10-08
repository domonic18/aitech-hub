/**
 * post-schema 单测(无 IO,确定性):状态展示态矩阵、slug 归一化边界、
 * 标签/封面/正文边界值。slug 归一化本体行为由 src/lib/slug.test.ts 钉住,这里只钉集成口径。
 */
import { describe, expect, it } from "vitest";

import {
  ADMIN_LIST_SEGMENTS,
  CONTENT_ORIGIN_BADGES,
  CONTENT_ORIGIN_LABELS,
  asContentOrigin,
  coverPathSchema,
  postCreateSchema,
  postDisplayState,
  postSlugSchema,
  postUpdateSchema,
  slugSchema,
} from "./post-schema";

describe("postDisplayState(展示态派生)", () => {
  it("published 即已发布(无论 publishedAt)", () => {
    expect(postDisplayState({ status: "published", publishedAt: null })).toBe("published");
    expect(postDisplayState({ status: "published", publishedAt: new Date() })).toBe("published");
  });

  it("draft 且无发布时间 = 纯草稿;有发布时间 = 已下架", () => {
    expect(postDisplayState({ status: "draft", publishedAt: null })).toBe("draft");
    expect(postDisplayState({ status: "draft", publishedAt: new Date() })).toBe("unpublished");
  });
});

describe("slugSchema(分类/标签沿用:先归一化再验空)", () => {
  it("trim + 归一化;百分号十六进制小写(WP rawurlencode 口径)", () => {
    expect(slugSchema.parse("  Hello-World  ")).toBe("Hello-World");
    expect(slugSchema.parse("重建博客")).toBe("%e9%87%8d%e5%bb%ba%e5%8d%9a%e5%ae%a2");
    expect(slugSchema.parse("My Post")).toBe("My%20Post");
  });

  it("归一化后为空 → 拒绝", () => {
    const r = slugSchema.safeParse("   ");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("slug 归一化后为空");
  });

  it("超长(>255)拒绝", () => {
    expect(slugSchema.safeParse("a".repeat(256)).success).toBe(false);
    expect(slugSchema.safeParse("a".repeat(255)).success).toBe(true);
  });
});

describe("coverPathSchema(M5-a 站内路径手填)", () => {
  it("空串合法(未设置);非 / 开头拒绝", () => {
    expect(coverPathSchema.parse("")).toBe("");
    expect(coverPathSchema.parse("  ")).toBe("");
    expect(coverPathSchema.safeParse("wp-content/a.png").success).toBe(false);
    expect(coverPathSchema.parse("/wp-content/uploads/a.png")).toBe("/wp-content/uploads/a.png");
  });
});

describe("postSlugSchema(2026-10 URL 终态:ASCII 装饰段,可空)", () => {
  it("归一:小写化、非 [a-z0-9] 折叠连字符、去首尾", () => {
    expect(postSlugSchema.parse("  Hello World  ")).toBe("hello-world");
    expect(postSlugSchema.parse("Claude Code+K2 模型")).toBe("claude-code-k2");
    expect(postSlugSchema.parse("--a__b--")).toBe("a-b");
  });

  it("归一后为空 → undefined(创建=按标题派生/更新=不改)", () => {
    expect(postSlugSchema.parse("")).toBeUndefined();
    expect(postSlugSchema.parse("  ")).toBeUndefined();
    expect(postSlugSchema.parse("中文标题")).toBeUndefined();
  });

  it("超长(>255)拒绝", () => {
    expect(postSlugSchema.safeParse("a".repeat(256)).success).toBe(false);
    expect(postSlugSchema.safeParse("a".repeat(255)).success).toBe(true);
  });

  it("undefined 直通(optional)", () => {
    expect(postSlugSchema.parse(undefined)).toBeUndefined();
  });
});

describe("postCreateSchema", () => {
  const base = { title: "T", categorySlug: "blog", contentMd: "x" };

  it("最小合法体:tags 默认空、contentOrigin 默认 human、可选字段归一为 undefined", () => {
    const r = postCreateSchema.parse(base);
    expect(r.tags).toEqual([]);
    expect(r.contentOrigin).toBe("human");
    expect(r.excerpt).toBeUndefined();
    expect(r.slug).toBeUndefined();
    expect(r.coverPath).toBeUndefined();
  });

  it("contentOrigin:合法值透传,非法值拒绝(应用层枚举)", () => {
    expect(postCreateSchema.parse({ ...base, contentOrigin: "ai_generated" }).contentOrigin).toBe(
      "ai_generated",
    );
    expect(postCreateSchema.safeParse({ ...base, contentOrigin: "ai_assisted" }).success).toBe(
      true,
    );
    expect(postCreateSchema.safeParse({ ...base, contentOrigin: "gpt" }).success).toBe(false);
  });

  it("标签最多 5 个;空标签拒绝", () => {
    expect(
      postCreateSchema.safeParse({ ...base, tags: ["a", "b", "c", "d", "e", "f"] }).success,
    ).toBe(false);
    expect(postCreateSchema.safeParse({ ...base, tags: ["   "] }).success).toBe(false);
  });

  it("标题/正文必填;显式 slug 归一为 ASCII(中文段折叠)", () => {
    expect(postCreateSchema.safeParse({ ...base, title: "  " }).success).toBe(false);
    expect(postCreateSchema.safeParse({ ...base, contentMd: "" }).success).toBe(false);
    expect(postCreateSchema.parse({ ...base, slug: " My Post " }).slug).toBe("my-post");
  });

  it("封面须 / 开头;摘要/SEO 超长拒绝", () => {
    expect(postCreateSchema.safeParse({ ...base, coverPath: "https://cdn/a.png" }).success).toBe(
      false,
    );
    expect(postCreateSchema.safeParse({ ...base, excerpt: "x".repeat(501) }).success).toBe(false);
    expect(postCreateSchema.safeParse({ ...base, seoTitle: "x".repeat(256) }).success).toBe(false);
    expect(postCreateSchema.safeParse({ ...base, seoDescription: "x".repeat(501) }).success).toBe(
      false,
    );
  });
});

describe("postUpdateSchema(更新含 slug:id 锚定 URL,改 slug 不毁外链)", () => {
  it("slug 字段存在且与创建同口径(缺省 = 不修改)", () => {
    expect("slug" in postUpdateSchema.shape).toBe(true);
    expect(
      postUpdateSchema.parse({ title: "T", categorySlug: "blog", contentMd: "x" }).slug,
    ).toBeUndefined();
    expect(
      postUpdateSchema.parse({ title: "T", categorySlug: "blog", contentMd: "x", slug: "New Slug" })
        .slug,
    ).toBe("new-slug");
  });
});

describe("contentOrigin(合规标识三值)", () => {
  it("asContentOrigin:合法值透传,历史脏值回退 human(读侧宽容)", () => {
    expect(asContentOrigin("human")).toBe("human");
    expect(asContentOrigin("ai_assisted")).toBe("ai_assisted");
    expect(asContentOrigin("ai_generated")).toBe("ai_generated");
    expect(asContentOrigin("gpt")).toBe("human");
    expect(asContentOrigin("")).toBe("human");
  });

  it("AI 系有徽章与完整文案,human 恒空(详情页不渲染)", () => {
    expect(CONTENT_ORIGIN_BADGES.human).toBe("");
    expect(CONTENT_ORIGIN_LABELS.human).toBe("");
    expect(CONTENT_ORIGIN_BADGES.ai_assisted).toBe("AI 辅助");
    expect(CONTENT_ORIGIN_BADGES.ai_generated).toBe("AI 生成");
    expect(CONTENT_ORIGIN_LABELS.ai_assisted.length).toBeGreaterThan(0);
    expect(CONTENT_ORIGIN_LABELS.ai_generated.length).toBeGreaterThan(0);
  });
});

describe("ADMIN_LIST_SEGMENTS(四分段与原型一致)", () => {
  it("all/published/draft/unpublished", () => {
    expect(ADMIN_LIST_SEGMENTS).toEqual(["all", "published", "draft", "unpublished"]);
  });
});
