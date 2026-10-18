/** 热榜源登记单测(M34 批③ 验收反馈:纳入采集计划管理):缺行=启用、
 * 拉取态回写计数口径、台账懒登记+今日条数、未知源拒绝、回写自吞不炸链。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const hsFindMany = vi.fn();
const hsUpsert = vi.fn();
const hsCreateMany = vi.fn();
const signalGroupBy = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    insightHotSource: {
      findMany: (...a: unknown[]) => hsFindMany(...a),
      upsert: (...a: unknown[]) => hsUpsert(...a),
      createMany: (...a: unknown[]) => hsCreateMany(...a),
    },
    insightSignal: { groupBy: (...a: unknown[]) => signalGroupBy(...a) },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

import {
  enabledHotSources,
  HotSourceError,
  listHotSourcesAdmin,
  recordHotSourceRun,
  setHotSourceEnabled,
} from "./hot-source";

beforeEach(() => {
  vi.clearAllMocks();
  hsFindMany.mockResolvedValue([]);
  hsUpsert.mockResolvedValue({});
  hsCreateMany.mockResolvedValue({ count: 0 });
  signalGroupBy.mockResolvedValue([]);
});

describe("enabledHotSources", () => {
  it("无停用行(缺行)时全部在役 fetcher 键均启用", async () => {
    const s = await enabledHotSources();
    expect([...s].sort()).toEqual(["hot-baidu", "hot-bilibili", "hot-zhihu"]);
  });

  it("enabled:false 的行整源剔除,其余保留", async () => {
    hsFindMany.mockResolvedValue([{ source: "hot-zhihu" }]);
    const s = await enabledHotSources();
    expect(s.has("hot-zhihu")).toBe(false);
    expect(s.has("hot-baidu")).toBe(true);
    expect(s.has("hot-bilibili")).toBe(true);
  });
});

describe("recordHotSourceRun", () => {
  it("成功回写:连败清零、末次错误抹除", async () => {
    await recordHotSourceRun("hot-baidu", true);
    expect(hsUpsert).toHaveBeenCalledTimes(1);
    const arg = hsUpsert.mock.calls[0]?.[0] as {
      where: { source: string };
      create: { consecutiveFails: number; lastError: string | null };
      update: { consecutiveFails: number; lastError: string | null };
    };
    expect(arg.where).toEqual({ source: "hot-baidu" });
    expect(arg.create.consecutiveFails).toBe(0);
    expect(arg.update.consecutiveFails).toBe(0);
    expect(arg.update.lastError).toBeNull();
  });

  it("失败回写:连败 +1、末次错误截 300 字", async () => {
    await recordHotSourceRun("hot-baidu", false, "x".repeat(400));
    const arg = hsUpsert.mock.calls[0]?.[0] as {
      create: { consecutiveFails: number; lastError: string };
      update: { consecutiveFails: { increment: number }; lastError: string };
    };
    expect(arg.create.consecutiveFails).toBe(1);
    expect(arg.update.consecutiveFails).toEqual({ increment: 1 });
    expect(arg.update.lastError).toHaveLength(300);
  });

  it("未知源不回写;DB 异常自吞仅告警(不炸信号主链路)", async () => {
    await recordHotSourceRun("not-a-source", true);
    expect(hsUpsert).not.toHaveBeenCalled();
    hsUpsert.mockRejectedValue(new Error("db down"));
    await expect(recordHotSourceRun("hot-baidu", true)).resolves.toBeUndefined();
  });
});

describe("listHotSourcesAdmin", () => {
  it("懒登记缺行 + 逐源映射 label/medium/今日条数", async () => {
    hsFindMany.mockResolvedValue([
      {
        source: "hot-baidu",
        enabled: false,
        consecutiveFails: 2,
        lastRunAt: new Date("2026-10-18T00:43:00+08:00"),
        lastError: "HTTP 403",
      },
    ]);
    signalGroupBy.mockResolvedValue([
      { source: "hot-baidu", _count: { _all: 7 } },
      { source: "hot-zhihu", _count: { _all: 3 } },
    ]);
    const rows = await listHotSourcesAdmin();
    // 缺行懒登记(zhihu/bilibili 补行,baidu 已在表)
    expect(hsCreateMany).toHaveBeenCalledWith({
      data: [{ source: "hot-zhihu" }, { source: "hot-bilibili" }],
      skipDuplicates: true,
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      source: "hot-baidu",
      label: "百度热搜",
      medium: "search",
      enabled: false,
      consecutiveFails: 2,
      todayCount: 7,
    });
    expect(rows[1]).toMatchObject({
      source: "hot-zhihu",
      label: "知乎热榜",
      medium: "voice",
      enabled: true,
      consecutiveFails: 0,
      todayCount: 3,
    });
    expect(rows[2]).toMatchObject({ source: "hot-bilibili", todayCount: 0 });
  });

  it("无缺行时不触发 createMany", async () => {
    hsFindMany.mockResolvedValue([
      { source: "hot-baidu" },
      { source: "hot-zhihu" },
      { source: "hot-bilibili" },
    ]);
    await listHotSourcesAdmin();
    expect(hsCreateMany).not.toHaveBeenCalled();
  });
});

describe("setHotSourceEnabled", () => {
  it("未知源抛 HotSourceError(unknown_source)", async () => {
    await expect(setHotSourceEnabled("nope", false)).rejects.toMatchObject({
      code: "unknown_source",
    });
    expect(hsUpsert).not.toHaveBeenCalled();
  });

  it("在役源 upsert 启停位(缺行落 create=目标态)", async () => {
    await setHotSourceEnabled("hot-bilibili", false);
    expect(hsUpsert).toHaveBeenCalledWith({
      where: { source: "hot-bilibili" },
      create: { source: "hot-bilibili", enabled: false },
      update: { enabled: false },
    });
  });

  it("HotSourceError 可作 instanceof 供路由层 404 分流", async () => {
    const e = new HotSourceError("unknown_source", "未知热榜源");
    expect(e).toBeInstanceOf(HotSourceError);
    expect(e).toBeInstanceOf(Error);
  });
});
