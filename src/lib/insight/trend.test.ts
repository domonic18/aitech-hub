/**
 * 洞察趋势层单测(M52 批A):增长分纯函数全分支(五级判据边界+前窗为零两态)+
 * listClusterTrends 的 SQL 形状与分级映射(prisma mock)。
 */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

import { prisma } from "../db";
import { growthOf, listClusterTrends, tierOf, TREND_TIER_LABELS } from "./trend";

const mockedRaw = vi.mocked(prisma.$queryRaw);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("growthOf 增长分", () => {
  it("标准公式:差值/前窗", () => {
    expect(growthOf(15, 10)).toBeCloseTo(0.5);
    expect(growthOf(5, 10)).toBeCloseTo(-0.5);
  });

  it("前窗 0 兜 1 防除零", () => {
    expect(growthOf(3, 0)).toBe(3);
    expect(growthOf(0, 0)).toBe(0);
  });
});

describe("tierOf 五级判据", () => {
  it("前窗 0:近窗 ≥3 → new,<3 → flat", () => {
    expect(tierOf(3, 0)).toBe("new");
    expect(tierOf(10, 0)).toBe("new");
    expect(tierOf(2, 0)).toBe("flat");
    expect(tierOf(0, 0)).toBe("flat");
  });

  it("边界:≥100% breakout;20%~100% rising;±20% 内 flat;≤−20% declining", () => {
    expect(tierOf(21, 10)).toBe("breakout"); // 1.1
    expect(tierOf(20, 10)).toBe("breakout"); // 1.0(含)
    expect(tierOf(19, 10)).toBe("rising"); // 0.9
    expect(tierOf(12, 10)).toBe("rising"); // 0.2(含)
    expect(tierOf(11, 10)).toBe("flat"); // 0.1
    expect(tierOf(9, 10)).toBe("flat"); // −0.1
    expect(tierOf(8, 10)).toBe("declining"); // −0.2(含)
    expect(tierOf(5, 10)).toBe("declining"); // −0.5
  });
});

describe("TREND_TIER_LABELS", () => {
  it("五级徽章齐全", () => {
    expect(Object.keys(TREND_TIER_LABELS)).toHaveLength(5);
  });
});

describe("listClusterTrends", () => {
  it("SQL 双窗 FILTER + 在役源过滤 + 分级映射", async () => {
    mockedRaw.mockResolvedValue([
      {
        id: BigInt(1),
        kind: "hot",
        label: "AI 编码",
        score: 88,
        recent: 20,
        prior: 10,
      },
      {
        id: BigInt(2),
        kind: "pain",
        label: null,
        score: null,
        recent: 0,
        prior: 0,
      },
    ] as never);

    const rows = await listClusterTrends(7);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      clusterId: BigInt(1),
      tier: "breakout",
      growth: expect.closeTo(1),
    });
    expect(rows[1]).toMatchObject({ clusterId: BigInt(2), tier: "flat", growth: 0 });

    const sql = mockedRaw.mock.calls[0][0] as TemplateStringsArray;
    const sqlText = sql.join("?");
    expect(sqlText).toContain("status = 'active'");
    expect(sqlText).toContain("signal_at >=");
    expect(sqlText).toContain("LEFT JOIN");
  });

  it("领域视图:簇侧 WHERE 注入域片段;全部视图片段为空(M54 批C)", async () => {
    mockedRaw.mockResolvedValue([] as never);
    await listClusterTrends(7, "tech");
    // 域片段恒为模板末位插值;Prisma.empty(空片段)即未筛
    expect(mockedRaw.mock.calls[0]!.at(-1)).not.toBe(Prisma.empty);

    await listClusterTrends(7);
    expect(mockedRaw.mock.calls[1]!.at(-1)).toBe(Prisma.empty);
  });
});
