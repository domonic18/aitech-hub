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

import {
  insightOverview,
  listInsightSignals,
  listInsightSignalsPage,
  pickSignalUrl,
} from "./admin";
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
  it("行映射(id 字符串化;meta.url→url,译文/状态/地域原样透传)", async () => {
    signalFindMany.mockResolvedValue([
      {
        id: BigInt(1),
        source: "hot-zhihu",
        medium: "voice",
        lang: "zh",
        region: "cn",
        rawText: "热榜问题",
        translatedText: null,
        translationStatus: "done",
        signalAt: new Date("2026-10-17T01:00:00Z"),
        meta: { url: "https://www.zhihu.com/question/1" },
      },
    ]);
    const rows = await listInsightSignals({});
    expect(rows[0]).toEqual({
      id: "1",
      source: "hot-zhihu",
      medium: "voice",
      lang: "zh",
      region: "cn",
      rawText: "热榜问题",
      translatedText: null,
      translationStatus: "done",
      url: "https://www.zhihu.com/question/1",
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

describe("pickSignalUrl", () => {
  it("只接受 http(s),其余协议/形态兜底 null(外链注入守门)", () => {
    expect(pickSignalUrl({ url: "https://v2ex.com/t/1" })).toBe("https://v2ex.com/t/1");
    expect(pickSignalUrl({ url: "HTTP://example.com/a" })).toBe("HTTP://example.com/a");
    expect(pickSignalUrl({ url: "javascript:alert(1)" })).toBeNull();
    expect(pickSignalUrl({ url: "data:text/html,<b>x</b>" })).toBeNull();
    expect(pickSignalUrl({ url: "" })).toBeNull();
    expect(pickSignalUrl({ url: 42 })).toBeNull();
    expect(pickSignalUrl({})).toBeNull();
    expect(pickSignalUrl(null)).toBeNull();
    expect(pickSignalUrl(["https://example.com"])).toBeNull();
  });
});

describe("listInsightSignalsPage", () => {
  it("分页 skip/take + 稳定排序 + 总页数;分源计数刻意不套当前源", async () => {
    signalFindMany.mockResolvedValue([]);
    signalCount.mockResolvedValue(120);
    signalGroupBy.mockResolvedValue([
      { source: "community-v2ex", _count: { _all: 80 } },
      { source: "hot-baidu", _count: { _all: 40 } },
    ]);
    const data = await listInsightSignalsPage({
      source: "hot-baidu",
      medium: "voice",
      page: 3,
      pageSize: 50,
    });
    expect(data.total).toBe(120);
    expect(data.pages).toBe(3);
    expect(data.page).toBe(3);
    expect(data.bySource).toEqual([
      { source: "community-v2ex", count: 80 },
      { source: "hot-baidu", count: 40 },
    ]);
    expect(signalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 100,
        take: 50,
        orderBy: [{ signalAt: "desc" }, { id: "desc" }],
      }),
    );
    // chips 计数与列表同一套筛选,但去掉 source 维度
    expect(signalGroupBy).toHaveBeenCalledWith({
      by: ["source"],
      where: {
        AND: [{ source: { in: [...INSIGHT_SOURCES_ENABLED] } }, { medium: "voice" }],
      },
      _count: { _all: true },
    });
  });

  it("pageSize 钳制到 1..200,页码非法回 1", async () => {
    signalFindMany.mockResolvedValue([]);
    signalCount.mockResolvedValue(0);
    signalGroupBy.mockResolvedValue([]);
    const data = await listInsightSignalsPage({ page: 0, pageSize: 999 });
    expect(data.page).toBe(1);
    expect(data.pages).toBe(1);
    expect(signalFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 200 }));
  });
});
