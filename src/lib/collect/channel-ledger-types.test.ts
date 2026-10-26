/** F17 渠道台账纯展示函数:健康 pill 四态与「最近运行」相对时刻文案 */
import { describe, expect, it } from "vitest";

import { healthOf, intervalText, lastRunLabel } from "./channel-ledger-types";

describe("healthOf", () => {
  it("停用优先 → 暂停", () => {
    expect(healthOf(false, 5, "error")).toEqual({ health: "paused", healthText: "暂停" });
  });

  it("error 状态或连败 ≥3 → 故障·连败 N", () => {
    expect(healthOf(true, 0, "error").healthText).toBe("故障·连败 0");
    expect(healthOf(true, 3, "healthy")).toEqual({ health: "fail", healthText: "故障·连败 3" });
  });

  it("degraded → 降级·限频;无状态字段连败 1-2 → 降级·连败 N", () => {
    expect(healthOf(true, 0, "degraded")).toEqual({ health: "degraded", healthText: "降级·限频" });
    expect(healthOf(true, 2, null)).toEqual({ health: "degraded", healthText: "降级·连败 2" });
  });

  it("健康", () => {
    expect(healthOf(true, 0, "healthy")).toEqual({ health: "healthy", healthText: "健康" });
  });
});

describe("lastRunLabel", () => {
  it("null → —", () => {
    expect(lastRunLabel(null, 0, "条")).toBe("—");
  });

  it("今日只显时刻(板「09:12 · 12 条」)", () => {
    const at = new Date();
    expect(lastRunLabel(at, 12, "条")).toMatch(/^\d{2}:\d{2} · 12 条$/);
  });

  it("count = null 只出时刻段", () => {
    expect(lastRunLabel(new Date(), null, "词")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("往日带相对天数(板「3 天前 · 0 条」)", () => {
    const at = new Date(Date.now() - 3 * 86_400_000);
    expect(lastRunLabel(at, 0, "条")).toBe("3 天前 · 0 条");
  });
});

describe("intervalText", () => {
  it("每 N 分钟", () => {
    expect(intervalText(30)).toBe("每 30 分钟");
  });
});

describe("intervalText 小时档", () => {
  it("≥60 且整除 60 → 每 N 小时(板「每 2 小时」)", () => {
    expect(intervalText(120)).toBe("每 2 小时");
    expect(intervalText(60)).toBe("每 1 小时");
  });

  it("非整除仍显分钟(板「每 90 分钟」)", () => {
    expect(intervalText(90)).toBe("每 90 分钟");
  });
});
