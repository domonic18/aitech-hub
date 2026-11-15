/**
 * 牌价免费语义单测(M74 批A):完全免费 vs 有免费额度必须分开,
 * 缺价(null)不当免费——「未公布」≠「0 元」。
 */
import { describe, expect, it } from "vitest";

import { isFreePrices, isFreeTiers } from "./rules";

describe("isFreePrices", () => {
  it("输入输出均为 0 → 免费", () => {
    expect(isFreePrices({ inputPrice: 0, outputPrice: 0 })).toBe(true);
  });

  it("仅 embedding 形态(输出缺价)且输入为 0 → 免费", () => {
    expect(isFreePrices({ inputPrice: 0, outputPrice: null })).toBe(true);
  });

  it("任一非零价 → 不免费", () => {
    expect(isFreePrices({ inputPrice: 0, outputPrice: 1 })).toBe(false);
    expect(isFreePrices({ inputPrice: 2, outputPrice: 0 })).toBe(false);
  });

  it("缺价不当免费(未公布 ≠ 0 元)", () => {
    expect(isFreePrices({ inputPrice: null, outputPrice: null })).toBe(false);
  });

  it("缓存价非零 → 不免费(有缓存计费就不是全免)", () => {
    expect(isFreePrices({ inputPrice: 0, outputPrice: 0, cachePrice: 0.1 })).toBe(false);
  });
});

describe("isFreeTiers", () => {
  it("空档位集不免费", () => {
    expect(isFreeTiers([])).toBe(false);
  });

  it("所有档位全零 → 免费", () => {
    expect(
      isFreeTiers([
        { inputPrice: 0, outputPrice: 0 },
        { inputPrice: null, outputPrice: null, cachePrice: 0 },
      ]),
    ).toBe(true);
  });

  it("任一档位非零 → 整行不免费", () => {
    expect(
      isFreeTiers([
        { inputPrice: 0, outputPrice: 0 },
        { inputPrice: 0, outputPrice: 0.5 },
      ]),
    ).toBe(false);
  });
});
