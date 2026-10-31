/**
 * 榜单汇率单测(M63 v2.1):假数据只走纯函数——外部接口载荷契约按 2026-10-31
 * 实测的 open.er-api.com 响应形状(不用假设的字段名);库/网络/日志全 mock,
 * 不触真 DB。读侧纪律:任何缺失/损坏/越界都不抛错,回落默认值并标 isFallback。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/net/egress-fetch", () => ({ fetchViaEgress: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { FX_RATE_FALLBACK, parseUsdCnyRatePayload, readStoredRate } from "./fx";

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
