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

  it("下架:人工定稿行 skip(定稿是人工确认过的价,不动)", () => {
    const d = decidePricingReview([row({ status: "enabled", isPinned: true })], "disabled", () => ({
      status: "error",
      consecutiveFails: 9,
    }));
    expect(d[0]?.action).toBe("skip");
    expect(d[0]?.reason).toContain("人工定稿");
  });

  it("上架:源按 vendor + 产出面查(同厂商的模型源与套餐源不串)", () => {
    const seen: string[] = [];
    const d = decidePricingReview(
      [row({ vendor: "腾讯云", target: "model" })],
      "enabled",
      (vendor, target) => {
        seen.push(`${vendor}|${target}`);
        return healthy;
      },
    );
    expect(seen).toEqual(["腾讯云|model"]);
    expect(d[0]?.action).toBe("apply");
    // 缺产出面的行按模型表查(与读侧默认一致)
    decidePricingReview([row({ vendor: "腾讯云" })], "enabled", (vendor, target) => {
      seen.push(`${vendor}|${target}`);
      return healthy;
    });
    expect(seen).toEqual(["腾讯云|model", "腾讯云|model"]);
  });
});
