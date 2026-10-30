/**
 * 洞察趋势层单测(M52 批A):增长分纯函数全分支(五级判据边界+前窗为零两态)+
 * listClusterTrends 的 SQL 形状与分级映射(prisma mock)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

import { prisma } from "../db";
import {
  countPendingClusters,
  growthOf,
  listClusterTrends,
  tierOf,
  TREND_TIER_LABELS,
} from "./trend";

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

  it("成熟簇成员门 + 领域视图:域片段仅在传域时注入(M54/M60 批C)", async () => {
    mockedRaw.mockResolvedValue([] as never);
    await listClusterTrends(7, "tech");
    const call = mockedRaw.mock.calls[0] as unknown[];
    // 成员数走子查询门(HAVING count(s.id) 数的是窗口内信号,不是成员)
    expect((call[0] as TemplateStringsArray).join("?")).toContain("insight_cluster_member m3");
    // Prisma.sql 片段不展开进 strings,取嵌套片段判域过滤
    const frags = call
      .slice(1)
      .filter(
        (v): v is { strings: string[]; values: unknown[] } =>
          typeof v === "object" &&
          v !== null &&
          Array.isArray((v as { strings?: unknown }).strings),
      );
    expect(frags.some((f) => f.strings.join("?").includes("c.domain = ?"))).toBe(true);
    expect(frags.flatMap((f) => f.values)).toContain("tech");

    await listClusterTrends(7);
    const noDomain = (mockedRaw.mock.calls[1] as unknown[])
      .slice(1)
      .filter(
        (v): v is { strings: string[]; values: unknown[] } =>
          typeof v === "object" &&
          v !== null &&
          Array.isArray((v as { strings?: unknown }).strings),
      );
    expect(noDomain.some((f) => f.strings.join("?").includes("c.domain = ?"))).toBe(false);
    expect(noDomain.flatMap((f) => f.values)).not.toContain("tech");
  });
});

describe("countPendingClusters", () => {
  it("成员 1..LABEL_MIN_MEMBERS-1 计数;kind/domain 过滤可选", async () => {
    mockedRaw.mockResolvedValue([{ n: BigInt(7) }] as never);
    expect(await countPendingClusters("tech", "hot")).toBe(7);
    const call = mockedRaw.mock.calls[0] as unknown[];
    const sqlText = (call[0] as TemplateStringsArray).join("?");
    expect(sqlText).toContain("BETWEEN 1 AND ?");
    const frags = call
      .slice(1)
      .filter(
        (v): v is { strings: string[]; values: unknown[] } =>
          typeof v === "object" &&
          v !== null &&
          Array.isArray((v as { strings?: unknown }).strings),
      ) as { strings: string[]; values: unknown[] }[];
    const fragText = frags.map((f) => f.strings.join("?")).join("\n");
    expect(fragText).toContain("c.domain = ?");
    expect(fragText).toContain("c.kind = ?");
    expect(frags.flatMap((f) => f.values)).toEqual(["tech", "hot"]);
    // 外层绑定只剩成员上限(LABEL_MIN_MEMBERS-1=2)
    expect(call.slice(1).filter((v) => typeof v === "number")).toEqual([2]);
  });
});
