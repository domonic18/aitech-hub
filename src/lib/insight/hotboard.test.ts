/** 渠道视图读侧单测(M34 批③):热榜双查询(当批+前批名次)分组/move 计算
 * /聚合去重计权(prisma mock;$queryRaw 两次调用按 Promise.all 求值序区分)。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rawQuery = vi.fn();
const clusterFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,先于本文件顶层 const,急切引用会 TDZ
  prisma: {
    $queryRaw: (_strings: TemplateStringsArray, ..._values: unknown[]) => rawQuery(),
    insightCluster: { findMany: (...a: unknown[]) => clusterFindMany(...a) },
  },
}));

import { insightKeywordCloud, latestHotBoard } from "./hotboard";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("latestHotBoard", () => {
  it("按源分组(白名单序)、rank 升序、fetchedAt=批内最新 signal_at;move 对齐前批名次", async () => {
    rawQuery
      .mockResolvedValueOnce([
        {
          id: BigInt(3),
          source: "hot-baidu",
          ref_id: "b-2",
          rank: 2,
          title: "第二名(原第一)",
          heat: 2.5,
          url: "https://b/2",
          signal_at: new Date("2026-10-18T07:43:01Z"),
        },
        {
          id: BigInt(1),
          source: "hot-baidu",
          ref_id: "b-1",
          rank: 1,
          title: "第一名",
          heat: null,
          url: null,
          signal_at: new Date("2026-10-18T07:43:00Z"),
        },
        {
          id: BigInt(5),
          source: "hot-baidu",
          ref_id: "b-9",
          rank: 3,
          title: "新上榜",
          heat: 1,
          url: null,
          signal_at: new Date("2026-10-18T07:43:02Z"),
        },
      ])
      // 第二次 $queryRaw = 前批名次表 {b-1:2, b-2:1} → 现批 b-1 ↑1、b-2 ↓1、b-9 新上榜
      .mockResolvedValueOnce([
        { source: "hot-baidu", ref_id: "b-1", rank: 2 },
        { source: "hot-baidu", ref_id: "b-2", rank: 1 },
      ]);
    const boards = await latestHotBoard();
    expect(boards.map((b) => b.source)).toEqual(["hot-baidu", "hot-zhihu", "hot-bilibili"]);
    const baidu = boards[0];
    expect(baidu.items.map((i) => i.rank)).toEqual([1, 2, 3]);
    expect(baidu.items[0]).toEqual({
      rank: 1,
      title: "第一名",
      heat: null,
      url: null,
      move: 1, // move = 前批名次 − 现名次 = 2−1 = ↑1
    });
    expect(baidu.items[1]?.move).toBe(-1);
    expect(baidu.items[2]?.move).toBeNull();
    expect(baidu.fetchedAt).toBe("2026-10-18T07:43:02.000Z");
    // 无数据源:空榜面+null fetchedAt
    expect(boards[1]).toEqual({ source: "hot-zhihu", fetchedAt: null, items: [] });
  });

  it("前批为空(首轮/单批源):全部 move=null,不报错", async () => {
    rawQuery
      .mockResolvedValueOnce([
        {
          id: BigInt(9),
          source: "hot-zhihu",
          ref_id: "z-1",
          rank: 1,
          title: "首拉",
          heat: null,
          url: null,
          signal_at: new Date("2026-10-18T07:43:05Z"),
        },
      ])
      .mockResolvedValueOnce([]);
    const boards = await latestHotBoard();
    const zhihu = boards[1]!;
    expect(zhihu.items).toEqual([{ rank: 1, title: "首拉", heat: null, url: null, move: null }]);
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
