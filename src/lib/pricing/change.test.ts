/**
 * 牌价变更判定单测(M74 批F):drop/rise/口径变更/不写行的边界。
 * 纯函数,无 mock。
 */
import { describe, expect, it } from "vitest";

import { classifyChange, type PriceSnapshot } from "./change";

const snap = (over: Partial<PriceSnapshot>): PriceSnapshot => ({
  currency: "CNY",
  priceUnit: "per_1m_tokens",
  inputPrice: 2,
  outputPrice: 8,
  ...over,
});

describe("classifyChange", () => {
  it("代表价下调 → drop,降幅百分比为正", () => {
    const c = classifyChange(snap({ inputPrice: 2 }), snap({ inputPrice: 1 }));
    expect(c).not.toBeNull();
    expect(c!.kind).toBe("drop");
    expect(c!.oldRepresentative).toBe(2);
    expect(c!.newRepresentative).toBe(1);
    expect(c!.dropPct).toBeCloseTo(50, 6);
  });

  it("代表价上调 → rise", () => {
    const c = classifyChange(snap({ inputPrice: 1 }), snap({ inputPrice: 2 }));
    expect(c!.kind).toBe("rise");
  });

  it("非 token 行代表价=生成价(outputPrice):按秒模型降价也判 drop", () => {
    const c = classifyChange(
      snap({ priceUnit: "per_second", inputPrice: null, outputPrice: 0.1 }),
      snap({ priceUnit: "per_second", inputPrice: null, outputPrice: 0.08 }),
    );
    expect(c!.kind).toBe("drop");
    expect(c!.dropPct).toBeCloseTo(20, 6);
  });

  it("价没变(含 0.1 与 0.10 的精度等值)→ 不写行", () => {
    expect(classifyChange(snap({ inputPrice: 2 }), snap({ inputPrice: 2 }))).toBeNull();
    expect(classifyChange(snap({ inputPrice: 0.1 }), snap({ inputPrice: 0.1 + 1e-9 }))).toBeNull();
  });

  it("未公布(null)不参与比较,不写行——「没公布价」不是降价也不是涨价", () => {
    expect(classifyChange(snap({ inputPrice: 2 }), snap({ inputPrice: null }))).toBeNull();
    expect(classifyChange(snap({ inputPrice: null }), snap({ inputPrice: 2 }))).toBeNull();
  });

  it("币种变 → currency_changed,永不计入降价", () => {
    const c = classifyChange(snap({ currency: "CNY" }), snap({ currency: "USD", inputPrice: 1 }));
    expect(c!.kind).toBe("currency_changed");
    expect(c!.dropPct).toBeNull();
  });

  it("计价单位变 → unit_changed(从百万 token 改按张,数字不可比)", () => {
    const c = classifyChange(
      snap({ priceUnit: "per_1m_tokens", inputPrice: 2, outputPrice: 8 }),
      snap({ priceUnit: "per_image", inputPrice: null, outputPrice: 0.1 }),
    );
    expect(c!.kind).toBe("unit_changed");
  });

  it("旧价为 0 → dropPct=null(从 0 到正数没有百分比意义)", () => {
    const c = classifyChange(
      snap({ inputPrice: 0, outputPrice: 0 }),
      snap({ inputPrice: 1, outputPrice: 2 }),
    );
    expect(c!.kind).toBe("rise");
    expect(c!.dropPct).toBeNull();
  });

  it("币种变更优先于单位变更(先判不可比,再判涨跌)", () => {
    const c = classifyChange(
      snap({ currency: "CNY", priceUnit: "per_1m_tokens" }),
      snap({ currency: "USD", priceUnit: "per_image" }),
    );
    expect(c!.kind).toBe("currency_changed");
  });
});
