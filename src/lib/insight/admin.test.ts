/** 洞察中心读侧单测(prisma mock,无真库):overview 缺日补 0/在役源过滤/
 * 分源合并 + 信号流恒限在役源与过滤传参(批③ 渠道转向后口径)。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/datetime", () => ({ statsDay: () => "2026-10-17" }));

const signalCount = vi.fn();
const signalGroupBy = vi.fn();
const signalFindMany = vi.fn();
const dailyQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  // 懒包装:工厂随被 mock 模块首查执行,先于本文件顶层 const,急切引用会 TDZ
  prisma: {
    insightSignal: {
      count: (...a: unknown[]) => signalCount(...a),
      groupBy: (...a: unknown[]) => signalGroupBy(...a),
      findMany: (...a: unknown[]) => signalFindMany(...a),
    },
    $queryRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => dailyQuery(...values),
  },
}));

import { insightOverview, listInsightSignals } from "./admin";
import { INSIGHT_SOURCES_ENABLED } from "./ingest";

beforeEach(() => {
  vi.clearAllMocks();
});

function mockOverview(): void {
  signalCount.mockImplementation((args?: { where?: { signalAt?: { gte?: Date } } }) => {
    // 首调=总量,次调=今日(signalAt gte 当日零点)
    if (args?.where?.signalAt?.gte) return Promise.resolve(3);
    return Promise.resolve(28);
  });
  signalGroupBy.mockImplementation((args?: { where?: { signalAt?: { gte?: Date } } }) => {
    // 首调=总量组(仅 source 过滤),次调=今日组(带 signalAt)
    if (args?.where?.signalAt?.gte)
      return Promise.resolve([{ source: "hot-baidu", _count: { _all: 2 } }]);
    return Promise.resolve([
      { source: "hot-baidu", _count: { _all: 20 } },
      { source: "telegram-ai", _count: { _all: 8 } },
    ]);
  });
  // 北京日界 2026-10-17 → UTC 锚 10-16T16:00Z;since=10-10T16:00Z,仅 10-12 有数据
  dailyQuery.mockResolvedValue([{ d: new Date("2026-10-12T16:00:00.000Z"), c: BigInt(5) }]);
}

describe("insightOverview", () => {
  it("总量/今日数字化、近 7 日缺日补 0(旧→新)、分源按总量降序并合并今日", async () => {
    mockOverview();
    const o = await insightOverview();
    expect(o.total).toBe(28);
    expect(o.today).toBe(3);
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
      { source: "hot-baidu", medium: "search", total: 20, today: 2 },
      { source: "telegram-ai", medium: "ai-record", total: 8, today: 0 },
    ]);
  });

  it("全部统计恒限在役源(批③ 渠道转向:存量站内源行不呈现)", async () => {
    mockOverview();
    await insightOverview();
    const enabled = [...INSIGHT_SOURCES_ENABLED];
    expect(signalCount).toHaveBeenNthCalledWith(1, {
      where: { source: { in: enabled } },
    });
    expect(signalCount).toHaveBeenNthCalledWith(2, {
      where: { source: { in: enabled }, signalAt: { gte: expect.any(Date) } },
    });
    expect(dailyQuery).toHaveBeenCalledTimes(1);
  });
});

describe("listInsightSignals", () => {
  it("行映射(id 字符串化;hitCount 口径随站内源退出移除)", async () => {
    signalFindMany.mockResolvedValue([
      {
        id: BigInt(1),
        source: "hot-zhihu",
        medium: "voice",
        rawText: "热榜问题",
        signalAt: new Date("2026-10-17T01:00:00Z"),
      },
    ]);
    const rows = await listInsightSignals({});
    expect(rows[0]).toEqual({
      id: "1",
      source: "hot-zhihu",
      medium: "voice",
      rawText: "热榜问题",
      signalAt: "2026-10-17T01:00:00.000Z",
    });
    expect(signalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ source: { in: [...INSIGHT_SOURCES_ENABLED] } }] },
      }),
    );
  });

  it("按源过滤与 limit 收口(上限 200)", async () => {
    signalFindMany.mockResolvedValue([]);
    await listInsightSignals({ source: "hot-baidu", limit: 999 });
    expect(signalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ source: { in: [...INSIGHT_SOURCES_ENABLED] } }, { source: "hot-baidu" }],
        },
        take: 200,
      }),
    );
  });
});
