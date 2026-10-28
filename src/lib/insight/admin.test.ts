/** 洞察中心读侧单测(prisma mock,无真库):overview 缺日补 0/在役源过滤/
 * 分源合并 + 信号流恒限在役源与过滤传参(批③ 渠道转向后口径)+ 领域视图
 * 过滤传参(M54 批C)。 */
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/datetime", async (importOriginal) => ({
  // M48 批F:日序列单源进 datetime,真身 cnDayKeyRange/DAY_MS 原样透传
  ...(await importOriginal()),
  statsDay: () => "2026-10-17",
}));

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
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
      dailyQuery(strings, ...values),
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
  // statsDay mock 恒 2026-10-17 → 序列锚 10-17(旧→新 10-17..10-23);d 为
  // to_char 北京日字符串,仅 10-19 有数据
  dailyQuery.mockResolvedValue([{ d: "2026-10-19", c: BigInt(5) }]);
}

describe("insightOverview", () => {
  it("总量/今日数字化、近 7 日缺日补 0(旧→新)、分源按总量降序并合并今日", async () => {
    mockOverview();
    const o = await insightOverview();
    expect(o.total).toBe(28);
    expect(o.today).toBe(3);
    expect(o.daily.map((d) => d.date)).toEqual([
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
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

  it("日增切桶显式北京时区(to_char AT TIME ZONE;勿退回 UTC date_trunc——日界错 8 小时)", async () => {
    mockOverview();
    await insightOverview();
    const sql = (dailyQuery.mock.calls[0]?.[0] as TemplateStringsArray).join("${v}");
    expect(sql).toContain("AT TIME ZONE 'Asia/Shanghai'");
  });

  it("领域视图:where 携带 domain,日增 SQL 注入域过滤片段(M54 批C)", async () => {
    mockOverview();
    await insightOverview(7, "tech");
    const enabled = [...INSIGHT_SOURCES_ENABLED];
    expect(signalCount).toHaveBeenNthCalledWith(1, {
      where: { source: { in: enabled }, domain: "tech" },
    });
    // 模板第 4 个插值 = 域过滤片段(recent/since、enabled 之后);空 Prisma.empty 即未筛
    const domainArg = (dailyQuery.mock.calls[0] as unknown[])[3];
    expect(domainArg).not.toBe(Prisma.empty);
  });

  it("全部视图:domain=undefined 不筛(SQL 域片段为 Prisma.empty)", async () => {
    mockOverview();
    await insightOverview(7, undefined);
    const domainArg = (dailyQuery.mock.calls[0] as unknown[])[3];
    expect(domainArg).toBe(Prisma.empty);
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

  it("按领域过滤(M54 批C:AND 数组加 domain,undefined 不筛)", async () => {
    signalFindMany.mockResolvedValue([]);
    await listInsightSignals({ domain: "tech" });
    expect(signalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ source: { in: [...INSIGHT_SOURCES_ENABLED] } }, { domain: "tech" }],
        },
      }),
    );
    await listInsightSignals({});
    expect(signalFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { AND: [{ source: { in: [...INSIGHT_SOURCES_ENABLED] } }] },
      }),
    );
  });
});
