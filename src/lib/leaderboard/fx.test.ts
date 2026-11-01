/**
 * 榜单汇率单测(M63 v2.1):假数据只走纯函数——外部接口载荷契约按 2026-10-31
 * 实测的 open.er-api.com 响应形状(不用假设的字段名);库/网络/日志全 mock,
 * 不触真 DB。读侧纪律:任何缺失/损坏/越界都不抛错,回落默认值并标 isFallback。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock, fetchMock, loggerMock, revalidateMock } = vi.hoisted(() => ({
  prismaMock: { siteConfig: { findUnique: vi.fn(), upsert: vi.fn() } },
  fetchMock: vi.fn(),
  loggerMock: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  revalidateMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/net/egress-fetch", () => ({ fetchViaEgress: fetchMock }));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("./revalidate", () => ({ revalidateLeaderboardPage: revalidateMock }));

import {
  FX_RATE_FALLBACK,
  ensureUsdCnyRate,
  isStaleRate,
  parseUsdCnyRatePayload,
  readStoredRate,
  type UsdCnyRate,
} from "./fx";

const OK_PAYLOAD = {
  result: "success",
  provider: "https://www.exchangerate-api.com",
  documentation: "https://www.exchangerate-api.com/docs/free",
  time_last_update_unix: 1793404801,
  time_last_update_utc: "Fri, 31 Oct 2026 00:00:01 +0000",
  base_code: "USD",
  rates: { USD: 1, CNY: 6.669566, EUR: 0.91 },
};

describe("parseUsdCnyRatePayload", () => {
  it("契约吻合:取 rates.CNY,四舍五入到 4 位,日期取接口自报时间", () => {
    expect(parseUsdCnyRatePayload(OK_PAYLOAD)).toEqual({
      rate: 6.6696,
      date: "2026-10-31",
      source: "open.er-api.com",
    });
  });

  it("自报时间缺失/非法 → 记采集日(北京日界)", () => {
    const now = new Date("2026-11-02T03:00:00Z"); // 北京 11-02 11:00
    const noTime = { ...OK_PAYLOAD, time_last_update_utc: undefined };
    expect(parseUsdCnyRatePayload(noTime, now)?.date).toBe("2026-11-02");
    const badTime = { ...OK_PAYLOAD, time_last_update_utc: "not-a-date" };
    expect(parseUsdCnyRatePayload(badTime, now)?.date).toBe("2026-11-02");
  });

  it("契约不符一律 null:非对象/result 非 success/币种非 USD/缺 rates", () => {
    expect(parseUsdCnyRatePayload(null)).toBeNull();
    expect(parseUsdCnyRatePayload("ok")).toBeNull();
    expect(parseUsdCnyRatePayload([])).toBeNull();
    expect(parseUsdCnyRatePayload({ ...OK_PAYLOAD, result: "error" })).toBeNull();
    expect(parseUsdCnyRatePayload({ ...OK_PAYLOAD, base_code: "CNY" })).toBeNull();
    expect(parseUsdCnyRatePayload({ ...OK_PAYLOAD, rates: null })).toBeNull();
    expect(parseUsdCnyRatePayload({ ...OK_PAYLOAD, rates: {} })).toBeNull();
  });

  it("汇率越界(脏值/契约漂移)也 null,不落库", () => {
    for (const cny of [0, -1, 1, 99, Number.NaN, "6.67", null]) {
      expect(parseUsdCnyRatePayload({ ...OK_PAYLOAD, rates: { CNY: cny } })).toBeNull();
    }
  });
});

describe("readStoredRate", () => {
  it("缺行 → 默认汇率并标 isFallback", () => {
    expect(readStoredRate(null)).toEqual({
      rate: FX_RATE_FALLBACK,
      date: null,
      source: null,
      isFallback: true,
    });
  });

  it("坏 JSON / 非对象 / 缺 rate / 越界 → 同样回落默认", () => {
    for (const raw of ["{", "[]", '"x"', "{}", '{"rate":"6.7"}', '{"rate":100}']) {
      expect(readStoredRate(raw).isFallback).toBe(true);
      expect(readStoredRate(raw).rate).toBe(FX_RATE_FALLBACK);
    }
  });

  it("正常值原样读出,缺 date/source 记 null 但不算回落", () => {
    expect(
      readStoredRate('{"rate":6.6696,"date":"2026-10-31","source":"open.er-api.com"}'),
    ).toEqual({
      rate: 6.6696,
      date: "2026-10-31",
      source: "open.er-api.com",
      isFallback: false,
    });
    expect(readStoredRate('{"rate":6.6696}')).toEqual({
      rate: 6.6696,
      date: null,
      source: null,
      isFallback: false,
    });
  });
});

describe("isStaleRate", () => {
  const NOW = new Date("2026-11-02T03:00:00Z"); // 北京 11-02 11:00

  function stored(date: string | null, isFallback = false): UsdCnyRate {
    return { rate: 6.6696, date, source: "open.er-api.com", isFallback };
  }

  it("从未采到(isFallback)或缺日期 → 陈旧", () => {
    expect(isStaleRate(readStoredRate(null), NOW)).toBe(true);
    expect(isStaleRate(stored(null), NOW)).toBe(true);
  });

  it("当日 / 前一日都算新鲜(容差:接口 00:00 UTC 更新,凌晨采集拿到的是前一北京日)", () => {
    expect(isStaleRate(stored("2026-11-02"), NOW)).toBe(false);
    expect(isStaleRate(stored("2026-11-01"), NOW)).toBe(false);
  });

  it("早于 24 小时前的北京日 → 陈旧", () => {
    expect(isStaleRate(stored("2026-10-31"), NOW)).toBe(true);
    expect(isStaleRate(stored("2026-09-01"), NOW)).toBe(true);
  });
});

describe("ensureUsdCnyRate(启动补偿)", () => {
  const NOW = new Date("2026-11-02T03:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    revalidateMock.mockResolvedValue(true);
  });

  it("库里有新鲜汇率 → 不触网、不写库、不失效页面", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValue({
      value: '{"rate":6.6696,"date":"2026-11-02","source":"open.er-api.com"}',
    });
    const got = await ensureUsdCnyRate(NOW);
    expect(got.rate).toBe(6.6696);
    expect(got.isFallback).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.siteConfig.upsert).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("无汇率行(首次上线)→ 补采一次并落库,随后失效榜单页", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ ok: true, json: async () => OK_PAYLOAD });
    prismaMock.siteConfig.upsert.mockResolvedValue({});
    const got = await ensureUsdCnyRate(NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.siteConfig.upsert).toHaveBeenCalledTimes(1);
    expect(revalidateMock).toHaveBeenCalledTimes(1);
    expect(got).toEqual({
      rate: 6.6696,
      date: "2026-10-31",
      source: "open.er-api.com",
      isFallback: false,
    });
  });

  it("补采失败 → 回落原值(不抛),只告警,定时任务仍兜底", async () => {
    prismaMock.siteConfig.findUnique.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const got = await ensureUsdCnyRate(NOW);
    expect(got.isFallback).toBe(true);
    expect(got.rate).toBe(FX_RATE_FALLBACK);
    expect(prismaMock.siteConfig.upsert).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "leaderboard.fx_ensure_failed" }),
    );
  });
});
