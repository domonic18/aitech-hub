/**
 * 批量路由共享件单测(M31 验收反馈):ids 载荷 schema 边界(非数字串拒/超上
 * 限拒)与去重保序。
 */
import { describe, expect, it } from "vitest";

import { batchIdsSchema, dedupeIds } from "./batch";

describe("batchIdsSchema", () => {
  it("数字串通过;非数字串/空串拒;超上限拒", () => {
    expect(batchIdsSchema(3).safeParse(["1", "22"]).success).toBe(true);
    expect(batchIdsSchema().safeParse(["12a"]).success).toBe(false);
    expect(batchIdsSchema().safeParse([""]).success).toBe(false);
    expect(batchIdsSchema(2).safeParse(["1", "2", "3"]).success).toBe(false);
    expect(batchIdsSchema().safeParse([]).success).toBe(false);
  });
});

describe("dedupeIds", () => {
  it("去重且保序", () => {
    expect(dedupeIds(["3", "1", "3", "2", "1"])).toEqual(["3", "1", "2"]);
  });
});
