/**
 * 牌价·套餐面策展单测(M55 批A,prisma mock 无真库):套餐列表过滤与排序传参。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const planFindMany = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    codingPlan: { findMany: (...a: unknown[]) => planFindMany(...a) },
  },
}));

import { listCodingPlans } from "./admin-plan";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("套餐列表过滤", () => {
  it("status 过滤下推 where,排序 sortOrder→updatedAt", async () => {
    planFindMany.mockResolvedValue([]);
    await listCodingPlans({ status: "pending" });
    expect(planFindMany).toHaveBeenCalledWith({
      where: { status: "pending" },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    });
    await listCodingPlans();
    expect(planFindMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    });
  });
});
