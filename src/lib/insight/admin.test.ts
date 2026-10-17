/** 洞察中心读侧单测(prisma mock,无真库):overview 缺日补 0/分源合并/
 * 零结果计数数字化 + 信号流 meta.hitCount 提取与过滤传参。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/datetime", () => ({ statsDay: () => "2026-10-17" }));

const signalCount = vi.fn();
const signalGroupBy = vi.fn();
const signalFindMany = vi.fn();
const dailyQuery = vi.fn();
const zeroQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,先于本文件顶层 const,急切引用会 TDZ
  prisma: {
    insightSignal: {
      count: (...a: unknown[]) => signalCount(...a),
      groupBy: (...a: unknown[]) => signalGroupBy(...a),
      findMany: (...a: unknown[]) => signalFindMany(...a),
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      void strings;
      // 首处调用=近7日日增序列,第二处=零结果搜索数(与 admin.ts 顺序耦合,
      // 单测内以调用序区分)
      const q =
        dailyQuery.mock.calls.length <= zeroQuery.mock.calls.length ? dailyQuery : zeroQuery;
      return q(...values);
    },
  },
}));

import { insightOverview, listInsightSignals } from "./admin";

beforeEach(() => {
  vi.clearAllMocks();
});

function mockOverview(): void {
  signalCount.mockImplementation((args?: { where?: { signalAt?: { gte?: Date } } }) => {
    // 首调=总量,次调=今日(signalAt gte 当日零点)
    if (args?.where?.signalAt?.gte) return Promise.resolve(3);
    return Promise.resolve(28);
  });
  signalGroupBy.mockImplementation((args?: { where?: unknown }) => {
    if (args?.where) return Promise.resolve([{ source: "internal-search", _count: { _all: 2 } }]);
    return Promise.resolve([
      { source: "internal-search", _count: { _all: 20 } },
      { source: "telegram-ai", _count: { _all: 8 } },
    ]);
  });
  // 北京日界 2026-10-17 → UTC 锚 10-16T16:00Z;since=10-10T16:00Z,仅 10-12 有数据
  dailyQuery.mockResolvedValue([{ d: new Date("2026-10-12T16:00:00.000Z"), c: BigInt(5) }]);
  zeroQuery.mockResolvedValue([{ c: BigInt(2) }]);
}

describe("insightOverview", () => {
  it("总量/今日/零结果数字化、近 7 日缺日补 0(旧→新)、分源按总量降序并合并今日", async () => {
    mockOverview();
    const o = await insightOverview();
    expect(o.total).toBe(28);
    expect(o.today).toBe(3);
    expect(o.zeroResultSearch7d).toBe(2);
    expect(o.daily.map((d) => d.date)).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
    ]);
    expect(o.daily[2].count).toBe(5);
    expect(o.daily.filter((d, i) => i !== 2).every((d) => d.count === 0)).toBe(true);
    expect(o.bySource).toEqual([
      { source: "internal-search", medium: "search", total: 20, today: 2 },
      { source: "telegram-ai", medium: "ai-record", total: 8, today: 0 },
    ]);
  });
});

describe("listInsightSignals", () => {
  it("meta.hitCount 提取:数字保留、非数字归 null;0 标 zeroResult", async () => {
    signalFindMany.mockResolvedValue([
      {
        id: BigInt(1),
        source: "internal-search",
        medium: "search",
        rawText: "无结果查询",
        meta: { hitCount: 0 },
        signalAt: new Date("2026-10-17T01:00:00Z"),
      },
      {
        id: BigInt(2),
        source: "internal-comment",
        medium: "voice",
        rawText: "评论内容",
        meta: null,
        signalAt: new Date("2026-10-17T02:00:00Z"),
      },
    ]);
    const rows = await listInsightSignals({});
    expect(rows[0]).toMatchObject({
      id: "1",
      hitCount: 0,
      zeroResult: true,
      signalAt: "2026-10-17T01:00:00.000Z",
    });
    expect(rows[1]).toMatchObject({ id: "2", hitCount: null, zeroResult: false });
  });

  it("按源过滤与 limit 收口(上限 200)", async () => {
    signalFindMany.mockResolvedValue([]);
    await listInsightSignals({ source: "internal-agent", limit: 999 });
    expect(signalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: "internal-agent" },
        take: 200,
      }),
    );
  });
});
