import { describe, expect, it } from "vitest";

import { isRealDay } from "./datetime";

describe("isRealDay", () => {
  it("真实日历日通过", () => {
    expect(isRealDay("2026-10-30")).toBe(true);
    expect(isRealDay("2024-02-29")).toBe(true); // 闰年
    expect(isRealDay("2026-12-31")).toBe(true);
  });

  it("格式合法但日期不存在的丢弃(否则查询拿到 Invalid Date 会 500)", () => {
    expect(isRealDay("2026-13-45")).toBe(false);
    expect(isRealDay("2026-02-30")).toBe(false);
    expect(isRealDay("2026-02-29")).toBe(false);
    expect(isRealDay("2026-00-10")).toBe(false);
  });

  it("形态不符/缺省一律丢弃", () => {
    expect(isRealDay(undefined)).toBe(false);
    expect(isRealDay("")).toBe(false);
    expect(isRealDay("2026-1-5")).toBe(false);
    expect(isRealDay("2026/10/30")).toBe(false);
    expect(isRealDay("yesterday")).toBe(false);
  });
});
