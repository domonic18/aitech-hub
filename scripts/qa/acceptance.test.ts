/**
 * 验收脚本抽样器单测:LCG 确定性(同 seed 可重放)、sample 无放回且不越界。
 * 报告可重放是验收纪律——同 seed 必须抽到同一批 URL(standard/02 §5)。
 */
import { describe, expect, it } from "vitest";

import { makeSampler, sample } from "./acceptance";

describe("makeSampler", () => {
  it("同 seed 序列完全一致(报告可重放)", () => {
    const a = makeSampler(20261003);
    const b = makeSampler(20261003);
    const sa = Array.from({ length: 10 }, () => a());
    const sb = Array.from({ length: 10 }, () => b());
    expect(sa).toEqual(sb);
  });

  it("不同 seed 序列不同;输出落在 [0,1)", () => {
    const a = makeSampler(1);
    const b = makeSampler(2);
    const sa = Array.from({ length: 20 }, () => a());
    const sb = Array.from({ length: 20 }, () => b());
    expect(sa).not.toEqual(sb);
    for (const v of [...sa, ...sb]) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of [...sa, ...sb]) expect(v).toBeLessThan(1);
  });
});

describe("sample", () => {
  const pool = Array.from({ length: 50 }, (_, i) => `item-${i}`);

  it("无放回:不重复、数量正确", () => {
    const picked = sample(pool, 30, makeSampler(7));
    expect(picked).toHaveLength(30);
    expect(new Set(picked).size).toBe(30);
    expect(picked.every((x) => pool.includes(x))).toBe(true);
  });

  it("n 超过池大小时取全池,不越界", () => {
    expect(sample(pool, 100, makeSampler(7))).toHaveLength(50);
    expect(sample([], 5, makeSampler(7))).toHaveLength(0);
  });

  it("同 seed 同池抽样结果一致", () => {
    expect(sample(pool, 10, makeSampler(42))).toEqual(sample(pool, 10, makeSampler(42)));
  });
});
