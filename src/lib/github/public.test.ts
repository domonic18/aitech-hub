/**
 * 前台公开读侧单测(M11 批③):prisma 打桩,验展示列表 display 过滤与排序、
 * 详情 slug+display 双条件(readmeMd 仅详情单点)、动态倒序限量、formatStars
 * 千分位口径(1.2k,不复用 telegram 万单位)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  githubRepo: {
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
    findFirst: vi.fn<(args?: unknown) => Promise<unknown>>(async () => null),
  },
  githubRepoActivity: {
    findMany: vi.fn<(args?: unknown) => Promise<unknown>>(async () => []),
  },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));

import { formatStars, getProjectBySlug, listRepoActivity, listShowcaseRepos } from "./public";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("读侧取数形状", () => {
  it("展示列表:display 过滤 + sortOrder→stars 排序;limit 下传 take", async () => {
    await listShowcaseRepos(3);
    const args = prismaMock.githubRepo.findMany.mock.calls[0][0] as {
      where: { display: boolean };
      orderBy: Record<string, string>[];
      take?: number;
    };
    expect(args.where).toEqual({ display: true });
    expect(args.orderBy).toEqual([{ sortOrder: "asc" }, { stars: "desc" }, { id: "asc" }]);
    expect(args.take).toBe(3);

    await listShowcaseRepos();
    expect(
      (prismaMock.githubRepo.findMany.mock.calls[1][0] as { take?: number }).take,
    ).toBeUndefined();
  });

  it("详情:slug + display 双条件(下架即查无);动态:occurredAt 倒序限量", async () => {
    await getProjectBySlug("demo");
    const detailArgs = prismaMock.githubRepo.findFirst.mock.calls[0][0] as {
      where: { slug: string; display: boolean };
    };
    expect(detailArgs.where).toEqual({ slug: "demo", display: true });

    await listRepoActivity(7, 20);
    const actArgs = prismaMock.githubRepoActivity.findMany.mock.calls[0][0] as {
      where: { repoId: number };
      orderBy: Record<string, string>[];
      take: number;
    };
    expect(actArgs.where).toEqual({ repoId: 7 });
    expect(actArgs.orderBy).toEqual([{ occurredAt: "desc" }, { id: "desc" }]);
    expect(actArgs.take).toBe(20);
  });
});

describe("formatStars(k 口径)", () => {
  it("千以下原样;千以上 1 位小数去尾零;十万级整数 k", () => {
    expect(formatStars(0)).toBe("0");
    expect(formatStars(42)).toBe("42");
    expect(formatStars(999)).toBe("999");
    expect(formatStars(1000)).toBe("1k");
    expect(formatStars(1234)).toBe("1.2k");
    expect(formatStars(12500)).toBe("12.5k");
    expect(formatStars(456_700)).toBe("457k");
  });
});
