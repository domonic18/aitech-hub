/**
 * 文章页上下文补全单测(M69):客户端只给 postId,标题/slug/门禁状态一律以
 * 已发布行为准;坏 id 不触库,查无(伪造/已下架)只留 page——不注入不存在的
 * 文章,也不把伪造的 gated 状态带进 run。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ post: { findFirst: vi.fn() } }));
vi.mock("../db", () => ({ prisma: prismaMock }));

import { enrichArticleContext } from "./article-context";

beforeEach(() => {
  prismaMock.post.findFirst.mockReset();
});

describe("enrichArticleContext", () => {
  it("无 article 段原样返回(不查库)", async () => {
    const ctx = { page: "电报流" };
    await expect(enrichArticleContext(ctx)).resolves.toBe(ctx);
    await expect(enrichArticleContext(null)).resolves.toBeNull();
    expect(prismaMock.post.findFirst).not.toHaveBeenCalled();
  });

  it("非法/超界 id 只留 page,不查库", async () => {
    await expect(
      enrichArticleContext({ page: "文章详情", article: { postId: "9".repeat(21) } }),
    ).resolves.toEqual({ page: "文章详情" });
    expect(prismaMock.post.findFirst).not.toHaveBeenCalled();
  });

  it("查无(伪造 id/已下架)只留 page", async () => {
    prismaMock.post.findFirst.mockResolvedValue(null);
    await expect(
      enrichArticleContext({ page: "文章详情", article: { postId: "123" } }),
    ).resolves.toEqual({ page: "文章详情" });
  });

  it("命中补 title/slug/gated;slug 为空时不带该键", async () => {
    prismaMock.post.findFirst.mockResolvedValue({
      slug: "hello",
      title: "标题",
      isPurchasable: false,
      isLoginRequired: true,
    });
    await expect(
      enrichArticleContext({
        page: "文章详情",
        article: { postId: "123", gated: false }, // 客户端伪造,以库为准
      }),
    ).resolves.toEqual({
      page: "文章详情",
      article: { postId: "123", title: "标题", slug: "hello", gated: true },
    });
    expect(prismaMock.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "published" }) }),
    );

    prismaMock.post.findFirst.mockResolvedValue({
      slug: null,
      title: "无 slug",
      isPurchasable: false,
      isLoginRequired: false,
    });
    const out = await enrichArticleContext({
      page: "文章详情",
      article: { postId: "124" },
    });
    expect(out?.article).toEqual({ postId: "124", title: "无 slug", gated: false });
  });
});
