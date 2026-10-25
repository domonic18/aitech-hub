/**
 * 统计读侧单测(M48 批G 补盲;prisma 必 mock):BigInt/Decimal 出口收口 number、
 * 窗口基元、热门页三路反解(id 锚定/slug 候选/前缀分类)与截断排序。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  statsReferrerDaily: { groupBy: vi.fn() },
  statsClientDaily: { groupBy: vi.fn() },
  statsPageDaily: { groupBy: vi.fn() },
  post: { findMany: vi.fn() },
  telegram: { count: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import {
  countTelegramSince,
  getClientPanel,
  getHotPages,
  getReferrerPanel,
  getVisitOverview,
  getVisitSeries,
} from "./queries";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getVisitOverview", () => {
  it("BigInt 出口收口 number,四窗口映射", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        t_pv: BigInt(5),
        t_uv: BigInt(3),
        y_pv: BigInt(2),
        y_uv: BigInt(1),
        w_pv: BigInt(10),
        w_uv: BigInt(7),
        m_pv: BigInt(20),
        m_uv: BigInt(12),
      },
    ]);
    await expect(getVisitOverview()).resolves.toEqual({
      today: { pv: 5, uv: 3 },
      yesterday: { pv: 2, uv: 1 },
      last7: { pv: 10, uv: 7 },
      last30: { pv: 20, uv: 12 },
    });
  });

  it("空表 → 全零(不 NaN)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const ov = await getVisitOverview();
    expect(ov.today).toEqual({ pv: 0, uv: 0 });
    expect(ov.last30).toEqual({ pv: 0, uv: 0 });
  });
});

describe("getVisitSeries / 面板", () => {
  it("序列行 BigInt→Number 直映", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { date: "2026-10-24", pv: BigInt(3), uv: BigInt(2) },
      { date: "2026-10-25", pv: BigInt(4), uv: BigInt(2) },
    ]);
    await expect(getVisitSeries(7)).resolves.toEqual([
      { date: "2026-10-24", pv: 3, uv: 2 },
      { date: "2026-10-25", pv: 4, uv: 2 },
    ]);
  });

  it("referrer 面板:totalPv 聚合 + BigInt 收口", async () => {
    prismaMock.statsReferrerDaily.groupBy.mockResolvedValue([
      { sourceClass: "search", sourceName: "google", _sum: { pv: BigInt(9), uv: BigInt(4) } },
      { sourceClass: "direct", sourceName: "direct", _sum: { pv: BigInt(1), uv: BigInt(1) } },
    ]);
    const panel = await getReferrerPanel(7);
    expect(panel.totalPv).toBe(10);
    expect(panel.rows[0]).toEqual({
      sourceClass: "search",
      sourceName: "google",
      pv: 9,
      uv: 4,
    });
  });

  it("client 面板:browser/device 两路 groupBy", async () => {
    prismaMock.statsClientDaily.groupBy
      .mockResolvedValueOnce([{ browser: "Chrome", _sum: { pv: BigInt(8) } }])
      .mockResolvedValueOnce([{ deviceType: "desktop", _sum: { pv: BigInt(8) } }]);
    await expect(getClientPanel(7)).resolves.toEqual({
      browsers: [{ name: "Chrome", pv: 8 }],
      devices: [{ name: "desktop", pv: 8 }],
    });
  });
});

describe("getHotPages 三路反解", () => {
  function mockGroupBy(rows: Array<{ path: string; _sum: { pv: bigint; uv: bigint } }>): void {
    prismaMock.statsPageDaily.groupBy.mockResolvedValue(rows);
  }

  it("id 锚定反解/slug 候选反解/page·list 分类/pv 降序", async () => {
    mockGroupBy([
      { path: "/post/12-claude-guide/", _sum: { pv: BigInt(50), uv: BigInt(30) } },
      { path: "/some-article/", _sum: { pv: BigInt(40), uv: BigInt(20) } },
      { path: "/about/", _sum: { pv: BigInt(10), uv: BigInt(5) } },
      { path: "/category/tech/", _sum: { pv: BigInt(8), uv: BigInt(4) } },
    ]);
    // 两次 findMany:先 id in(仅 /post/ 前缀),后 slug in(裸段)
    prismaMock.post.findMany.mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        if ("id" in args.where) return [{ id: BigInt(12), title: "Claude 指南" }] as never;
        return [{ slug: "some-article", title: "某文章" }] as never;
      },
    );
    const rows = await getHotPages("7d");
    expect(rows).toEqual([
      { path: "/post/12-claude-guide/", pv: 50, uv: 30, postTitle: "Claude 指南", kind: "article" },
      { path: "/some-article/", pv: 40, uv: 20, postTitle: "某文章", kind: "article" },
      { path: "/about/", pv: 10, uv: 5, postTitle: null, kind: "page" },
      { path: "/category/tech/", pv: 8, uv: 4, postTitle: null, kind: "list" },
    ]);
  });

  it("limit 截断在排序后生效", async () => {
    mockGroupBy([
      { path: "/a/", _sum: { pv: BigInt(1), uv: BigInt(1) } },
      { path: "/b/", _sum: { pv: BigInt(9), uv: BigInt(1) } },
    ]);
    prismaMock.post.findMany.mockResolvedValue([] as never);
    const rows = await getHotPages("today", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.path).toBe("/b/"); // 先多取再排,截断保留 pv 最高
  });
});

describe("countTelegramSince", () => {
  it("since 直传 count where", async () => {
    const since = new Date("2026-10-25T00:00:00Z");
    prismaMock.telegram.count.mockResolvedValue(7);
    await expect(countTelegramSince(since)).resolves.toBe(7);
    expect(prismaMock.telegram.count).toHaveBeenCalledWith({
      where: { createdAt: { gte: since } },
    });
  });
});
