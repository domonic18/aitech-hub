/**
 * 牌价计价单位归一单测:token 系一律「元/百万 tokens」。
 */
import { describe, expect, it } from "vitest";

import { isTokenUnit, normalizedUnit, toPerMillion, tokenUnitFactor } from "./units";

describe("units(计价单位归一)", () => {
  it("per_1k 的价按 ×1000 换算到每百万 tokens", () => {
    expect(tokenUnitFactor("per_1k_tokens")).toBe(1000);
    expect(tokenUnitFactor("per_1m_tokens")).toBe(1);
    expect(toPerMillion(0.8, "per_1k_tokens")).toBe(800);
    expect(toPerMillion(12, "per_1m_tokens")).toBe(12);
  });

  it("未公布价(null)原样返回,不当 0", () => {
    expect(toPerMillion(null, "per_1k_tokens")).toBeNull();
  });

  it("非 token 单位(按张/按秒)不换算", () => {
    expect(toPerMillion(0.2, "per_image")).toBe(0.2);
    expect(tokenUnitFactor("per_image")).toBe(1);
  });

  it("归一后的单位:token 系 → per_1m_tokens;其余原样", () => {
    expect(normalizedUnit("per_1k_tokens")).toBe("per_1m_tokens");
    expect(normalizedUnit("per_1m_tokens")).toBe("per_1m_tokens");
    expect(normalizedUnit("per_image")).toBe("per_image");
    expect(normalizedUnit("per_second")).toBe("per_second");
  });

  it("token 系判定(双价语义)", () => {
    expect(isTokenUnit("per_1m_tokens")).toBe(true);
    expect(isTokenUnit("per_1k_tokens")).toBe(true);
    expect(isTokenUnit("per_image")).toBe(false);
  });
});
