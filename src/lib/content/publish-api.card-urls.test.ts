/**
 * 卡图清单闸单测(M72 B1):upsert_article 声明 cardUrls 后,「清单里每张卡都已
 * 嵌入正文」才放行——渲了卡却漏嵌正文,卡片在站内会退化成普通配图。
 * 闸本身(嵌入自洽 + 同图重复)在 card-embeds.test;这里守「service 层真的
 * 调了它、且漏嵌即拒」。
 */
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  postFindUnique: vi.fn(),
  postFindFirst: vi.fn(),
  postCreate: vi.fn(),
  postUpdate: vi.fn(),
  taxonomyWrite: vi.fn(),
  mediaWrite: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    post: {
      findUnique: (...a: unknown[]) => hoisted.postFindUnique(...a),
      findFirst: (...a: unknown[]) => hoisted.postFindFirst(...a),
      create: (...a: unknown[]) => hoisted.postCreate(...a),
      update: (...a: unknown[]) => hoisted.postUpdate(...a),
    },
    taxonomy: {
      upsertCategory: (...a: unknown[]) => hoisted.taxonomyWrite(...a),
      upsertTag: (...a: unknown[]) => hoisted.taxonomyWrite(...a),
      setPostTags: (...a: unknown[]) => hoisted.taxonomyWrite(...a),
    },
    media: {
      syncPostMediaRefs: (...a: unknown[]) => hoisted.mediaWrite(...a),
    },
  },
}));

vi.mock("./posts-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./posts-admin")>()),
  createPost: hoisted.createPost,
  updatePost: hoisted.updatePost,
}));
vi.mock("@/lib/distribute/wechat-sync", () => ({ maybeEnqueueAutoWechat: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { upsertArticle } from "./publish-api";

const ACTOR = { kind: "pat", sub: "7", patId: "3" } as const;

const CARD = "/wp-content/uploads/2026/11/card-a.png";

describe("upsert_article 卡图清单闸", () => {
  it("声明了 cardUrls 但正文漏嵌该卡 → 拒稿(不落库)", async () => {
    hoisted.postFindUnique.mockResolvedValue(null);
    hoisted.postFindFirst.mockResolvedValue(null);
    await expect(
      upsertArticle({
        markdown: `---\ntitle: 标题\n---\n\n正文里没有卡片\n`,
        cardUrls: [CARD],
        actor: ACTOR,
      }),
    ).rejects.toThrow(/缺少 1 张已渲染卡片图/);
    expect(hoisted.createPost).not.toHaveBeenCalled();
  });

  it("不声明 cardUrls → 不走这道闸(现有调用方行为不变)", async () => {
    hoisted.postFindUnique.mockResolvedValue(null);
    hoisted.postFindFirst.mockResolvedValue(null);
    hoisted.createPost.mockResolvedValue({ id: 1, slug: "demo", status: "draft" });
    hoisted.taxonomyWrite.mockResolvedValue(undefined);
    hoisted.mediaWrite.mockResolvedValue(undefined);
    const r = await upsertArticle({
      markdown: `---\ntitle: 标题\n---\n\n正文\n`,
      actor: ACTOR,
    });
    expect(r.action).toBe("created");
    expect(hoisted.createPost).toHaveBeenCalled();
  });
});
