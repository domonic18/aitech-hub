/**
 * 牌价终审闸门单测(M75 运维面):上架严、下架宽。纯函数,无 mock。
 */
import { describe, expect, it } from "vitest";

import { HEALTH_THRESHOLDS } from "@/lib/collect/health-report";

import { decidePricingReview } from "./review-gate";

const row = (over: Partial<Parameters<typeof decidePricingReview>[0][number]> = {}) => ({
  id: "1",
  vendor: "DeepSeek 深度求索",
  modelKey: "deepseek-chat",
  status: "pending",
  note: null,
  ...over,
});
const healthy = { status: "healthy", consecutiveFails: 0 };

describe("decidePricingReview(牌价终审闸门)", () => {
  it("上架:带「待复核」标 → 拒(价已陈旧)", () => {
    const d = decidePricingReview(
      [row({ note: "【待复核 2026-11-18】旧行" })],
      "enabled",
      () => healthy,
    );
    expect(d[0]?.action).toBe("reject");
    expect(d[0]?.reason).toContain("待复核");
  });

  it("上架:采集源不健康(status=error / 连败≥3)→ 拒", () => {
    const bad = { status: "error", consecutiveFails: 0 };
    expect(decidePricingReview([row()], "enabled", () => bad)[0]?.action).toBe("reject");
    const fails = { status: "healthy", consecutiveFails: HEALTH_THRESHOLDS.consecutiveFails };
    expect(decidePricingReview([row()], "enabled", () => fails)[0]?.action).toBe("reject");
  });

  it("上架:找不到对应源 → 拒(无法确认数据新鲜度)", () => {
    expect(decidePricingReview([row()], "enabled", () => undefined)[0]?.action).toBe("reject");
  });

  it("上架:源健康且无待复核标 → apply;已同态行 → skip", () => {
    expect(decidePricingReview([row()], "enabled", () => healthy)[0]?.action).toBe("apply");
    const same = decidePricingReview([row({ status: "enabled" })], "enabled", () => healthy);
    expect(same[0]?.action).toBe("skip");
  });

  it("下架:不受待复核/源健康两道闸(止损优先)", () => {
    const d = decidePricingReview(
      [row({ note: "【待复核】旧行", status: "enabled" })],
      "disabled",
      () => ({ status: "error", consecutiveFails: 9 }),
    );
    expect(d[0]?.action).toBe("apply");
  });
});
