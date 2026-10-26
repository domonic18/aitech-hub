/**
 * 列表读侧单测(prisma 必 mock):M23 延伸需求——列表条目挂评论数/点赞数。
 * 覆盖:visible 过滤(隐藏评论不计)、未命中缺省 0、页内 id 批量 in、
 * 空页短路不发计数查询。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  post: { findMany: vi.fn(), count: vi.fn() },
  postComment: { groupBy: vi.fn() },
  postLike: { groupBy: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { listPostsPage } from "./posts";

beforeEach(() => {
  for (const m of [
    prismaMock.post.findMany,
    prismaMock.post.count,
    prismaMock.postComment.groupBy,
    prismaMock.postLike.groupBy,
  ]) {
    m.mockReset();
  }
  // 数组形 $transaction:依序执行传入的 promise
  prismaMock.$transaction.mockReset().mockImplementation((ops) => Promise.all(ops));
});

const ROW = (id: bigint) => ({
  id,
  slug: `p-${id}`,
  title: `t${id}`,
  excerpt: null,
  coverPath: null,
  viewsCount: 1,
  isPinned: false,
  isPurchasable: false,
  publishedAt: new Date(),
  updatedAt: new Date(),
  seoDescription: null,
  category: { slug: "c", name: "C" },
  tags: [],
});

describe("listPostsPage 交互计数挂载(M23)", () => {
  it("评论只数 visible、未命中缺省 0、两计数各自独立", async () => {
    prismaMock.post.findMany.mockResolvedValue([ROW(BigInt(1)), ROW(BigInt(2)), ROW(BigInt(3))]);
    prismaMock.post.count.mockResolvedValue(3);
    prismaMock.postComment.groupBy.mockResolvedValue([
      { postId: BigInt(1), _count: { postId: 2 } },
    ]);
    prismaMock.postLike.groupBy.mockResolvedValue([{ postId: BigInt(2), _count: { postId: 5 } }]);

    const { items } = await listPostsPage({ page: 1, pageSize: 10 });
    expect(items[0]).toMatchObject({ commentCount: 2, likeCount: 0 });
    expect(items[1]).toMatchObject({ commentCount: 0, likeCount: 5 });
    expect(items[2]).toMatchObject({ commentCount: 0, likeCount: 0 });

    const commentArg = prismaMock.postComment.groupBy.mock.calls[0]![0] as {
      where: { postId: { in: bigint[] }; status: string };
    };
    expect(commentArg.where.status).toBe("visible");
    expect(commentArg.where.postId.in).toEqual([BigInt(1), BigInt(2), BigInt(3)]);
    const likeArg = prismaMock.postLike.groupBy.mock.calls[0]![0] as {
      where: { postId: { in: bigint[] } };
    };
    expect(likeArg.where.postId).not.toHaveProperty("status");
  });

  it("空页短路:不发计数查询", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);
    prismaMock.post.count.mockResolvedValue(0);
    const { items } = await listPostsPage({ page: 1, pageSize: 10 });
    expect(items).toEqual([]);
    expect(prismaMock.postComment.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.postLike.groupBy).not.toHaveBeenCalled();
  });
});
