/**
 * 信号独立页参数钳制/URL 构造/日期折算(纯函数单测;SIGNAL_PAGE_SIZE 由
 * 取数层 admin.test.ts 覆盖)。
 */
import { describe, expect, it } from "vitest";

import {
  SIGNALS_PATH,
  nextDay,
  resolveSignalFilters,
  signalRange,
  signalsHref,
} from "./signals-view";

describe("resolveSignalFilters", () => {
  it("合法值原样保留,page 解析", () => {
    expect(
      resolveSignalFilters({
        source: "community-v2ex",
        medium: "voice",
        region: "cn",
        from: "2026-10-01",
        to: "2026-10-30",
        page: "3",
      }),
    ).toEqual({
      source: "community-v2ex",
      medium: "voice",
      region: "cn",
      from: "2026-10-01",
      to: "2026-10-30",
      page: 3,
    });
  });

  it("白名单外的值一律丢弃,页码非法回落 1", () => {
    expect(
      resolveSignalFilters({
        source: "internal-search", // 已停接入,不在在役白名单
        medium: "video", // 词表外(合法集:money/time/voice/search/ai-record)
        region: "mixed", // 信号地域只有 cn/global
        from: "2026/10/01",
        to: "yesterday",
        page: "-2",
      }),
    ).toEqual({
      source: undefined,
      medium: undefined,
      region: undefined,
      from: undefined,
      to: undefined,
      page: 1,
    });
  });

  it("空参数集只回页码 1", () => {
    expect(resolveSignalFilters({})).toEqual({ page: 1 });
  });
});

describe("signalsHref", () => {
  it("无筛选时回 base 路径", () => {
    expect(signalsHref({ page: 1 })).toBe(SIGNALS_PATH);
  });

  it("筛选与页码按固定键序落串(空值不落)", () => {
    expect(
      signalsHref(
        { source: "community-v2ex", region: "global", from: "2026-10-01", page: 2 },
        { medium: "voice" },
      ),
    ).toBe(
      "/admin/insight/signals/?source=community-v2ex&medium=voice&region=global&from=2026-10-01&page=2",
    );
  });

  it("overrides 可清空维度(切 chips 同时回第 1 页)", () => {
    const base = { source: "hot-baidu", page: 4 } as const;
    expect(signalsHref({ ...base }, { source: undefined, page: 1 })).toBe(SIGNALS_PATH);
  });
});

describe("日期折算", () => {
  it("nextDay 跨月/跨年", () => {
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
  });

  it("signalRange 按北京日界折算(from ≥ 当日 00:00+08,to < 次日 00:00+08)", () => {
    const { from, to } = signalRange({ from: "2026-10-01", to: "2026-10-30", page: 1 });
    expect(from?.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(to?.toISOString()).toBe("2026-10-30T16:00:00.000Z");
  });

  it("缺维度回 undefined(不产生空条件)", () => {
    expect(signalRange({ page: 1 })).toEqual({ from: undefined, to: undefined });
  });
});
