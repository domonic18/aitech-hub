/** 词库产出效能纯函数单测(批② 词动线):字重=候选数+批准×3;零值/大量级
 * 边界。聚合查询 keywordYieldAdmin 需真库,不在单测范围。 */
import { describe, expect, it } from "vitest";

import { keywordYieldWeight } from "./word-yield";

describe("keywordYieldWeight", () => {
  it("候选数为主,批准 ×3 加权", () => {
    expect(keywordYieldWeight({ candidates: 10, approved: 2 })).toBe(16);
    expect(keywordYieldWeight({ candidates: 0, approved: 0 })).toBe(0);
    expect(keywordYieldWeight({ candidates: 1, approved: 0 })).toBe(1);
  });

  it("同候选数下批准多的词更重(质量信号)", () => {
    const a = keywordYieldWeight({ candidates: 5, approved: 0 });
    const b = keywordYieldWeight({ candidates: 5, approved: 3 });
    expect(b).toBeGreaterThan(a);
  });
});
