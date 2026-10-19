/** 任务运行台账纯函数单测(验收二批③):摘要打包/错误截断/连败判定。 */
import { describe, expect, it } from "vitest";

import { clipError, consecutiveFails, packSummary } from "./runlog";

/** Json 值窄化为对象(断言用;测试输入都是对象形态) */
function asObj(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

describe("packSummary", () => {
  it("小对象原样透传,量长用的 stringify 不改形", () => {
    expect(packSummary({ removed: 3, guestRemoved: 0 })).toEqual({
      removed: 3,
      guestRemoved: 0,
    });
  });

  it("标量包一层 value(Json 列要对象形态可查)", () => {
    expect(packSummary("ok")).toEqual({ value: "ok" });
    expect(packSummary(42)).toEqual({ value: 42 });
  });

  it("超长截断为预览对象(preview 截在 4000)", () => {
    const big = { items: Array.from({ length: 2000 }, (_, i) => `item-${i}`) };
    const packed = asObj(packSummary(big));
    expect(packed.truncated).toBe(true);
    expect(packed.preview as string).toHaveLength(4000);
    expect(packed.preview as string).toContain("item-0");
  });

  it("超长字符串同样截断", () => {
    const packed = asObj(packSummary("x".repeat(5000)));
    expect(packed.truncated).toBe(true);
    expect(packed.preview as string).toHaveLength(4000);
  });

  it("循环引用/不可序列化值降级为字符串说明,不 throw", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(asObj(packSummary(circular)).unserializable).toContain("[object Object]");
  });
});

describe("clipError", () => {
  it("4000 内原样,超长截断", () => {
    expect(clipError("boom")).toBe("boom");
    expect(clipError("x".repeat(5000))).toHaveLength(4000);
  });
});

describe("consecutiveFails", () => {
  it("数开头连续 failed,遇 success 归零", () => {
    expect(consecutiveFails(["failed", "failed", "success", "failed"])).toBe(2);
    expect(consecutiveFails(["success"])).toBe(0);
    expect(consecutiveFails([])).toBe(0);
  });

  it("running 不参与判定(终态口径),夹在前面不截断也不计数", () => {
    expect(consecutiveFails(["running", "failed", "failed", "success"])).toBe(2);
    expect(consecutiveFails(["running", "success"])).toBe(0);
  });

  it("全失败全计(新→旧)", () => {
    expect(consecutiveFails(["failed", "failed", "failed"])).toBe(3);
  });
});
