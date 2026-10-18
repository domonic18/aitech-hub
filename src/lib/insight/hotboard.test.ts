/** 渠道视图读侧单测(M34 批③):热榜批内连接分组/聚合去重计权(prisma mock)。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const boardQuery = vi.fn();
const clusterFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,先于本文件顶层 const,急切引用会 TDZ
  prisma: {
    $queryRaw: (_strings: TemplateStringsArray, ..._values: unknown[]) => boardQuery(),
    insightCluster: { findMany: (...a: unknown[]) => clusterFindMany(...a) },
  },
}));

import { insightKeywordCloud, latestHotBoard } from "./hotboard";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("latestHotBoard", () => {
  it("按源分组(白名单序)、rank 升序、fetchedAt=批内最新 signal_at", async () => {
    boardQuery.mockResolvedValue([
      {
        id: BigInt(3),
        source: "hot-baidu",
        rank: 2,
        title: "第二名",
        heat: 2.5,
        url: "https://b/2",
        signal_at: new Date("2026-10-18T07:43:01Z"),
      },
      {
        id: BigInt(1),
        source: "hot-baidu",
        rank: 1,
        title: "第一名",
        heat: null,
        url: null,
        signal_at: new Date("2026-10-18T07:43:00Z"),
      },
    ]);
    const boards = await latestHotBoard();
    expect(boards.map((b) => b.source)).toEqual(["hot-baidu", "hot-zhihu", "hot-bilibili"]);
    const baidu = boards[0];
    expect(baidu.items.map((i) => i.rank)).toEqual([1, 2]);
    expect(baidu.items[0]).toEqual({ rank: 1, title: "第一名", heat: null, url: null });
    expect(baidu.fetchedAt).toBe("2026-10-18T07:43:01.000Z");
    // 无数据源:空榜面+null fetchedAt
    expect(boards[1]).toEqual({ source: "hot-zhihu", fetchedAt: null, items: [] });
  });
});

describe("insightKeywordCloud", () => {
  it("keywords 摊平、同词取最高簇分、短词剔除、按权重降序截断", async () => {
    clusterFindMany.mockResolvedValue([
      {
        id: BigInt(1),
        label: "AI 编程工具",
        keywords: ["Cursor", " AI ", "a", "编程"],
        score: 80,
      },
      { id: BigInt(2), label: "多模态", keywords: ["AI", "视频生成"], score: 65 },
      { id: BigInt(3), label: "未计分簇", keywords: ["无分词"], score: null },
      { id: BigInt(4), label: "closed 簇不取", keywords: [], score: 99 }, // where 层已滤,双保险
    ]);
    const words = await insightKeywordCloud({ limit: 2 });
    expect(words).toEqual([
      { word: "Cursor", weight: 80, clusterId: "1", label: "AI 编程工具" },
      { word: "AI", weight: 80, clusterId: "1", label: "AI 编程工具" }, // 80 > 65 取高
    ]);
    expect(clusterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ label: { not: null }, status: { not: "closed" } }),
      }),
    );
  });

  it("空窗口返空数组", async () => {
    clusterFindMany.mockResolvedValue([]);
    expect(await insightKeywordCloud()).toEqual([]);
  });
});
