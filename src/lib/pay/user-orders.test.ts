/**
 * user-orders / account-usage 读侧单测(prisma 必 mock):归属过滤与
 * 分页参数(where/skip/take)、Decimal→字符串映射、流水映射、本月消耗
 * 聚合(costOfRow 口径:failed 不计费、未定价按 0)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  payOrder: { findMany: vi.fn(), count: vi.fn() },
  userTokenLedger: { findMany: vi.fn(), count: vi.fn() },
  aiUsageLog: { findMany: vi.fn() },
  aiModel: { findMany: vi.fn() },
  asrConfig: { findFirst: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { listOrdersForUser } from "./user-orders";
import { summarizeMonthUsage, type MonthUsageSummary } from "../users/account-usage";
import type { UsagePrices } from "../ai/usage-queries";

beforeEach(() => {
  for (const m of [
    prismaMock.payOrder.findMany,
    prismaMock.payOrder.count,
    prismaMock.userTokenLedger.findMany,
    prismaMock.userTokenLedger.count,
    prismaMock.aiUsageLog.findMany,
    prismaMock.aiModel.findMany,
    prismaMock.asrConfig.findFirst,
  ]) {
    m.mockReset();
  }
});

describe("listOrdersForUser", () => {
  it("归属硬过滤 + 状态分段 + 分页参数(第 2 页 skip=15)", async () => {
    prismaMock.payOrder.findMany.mockResolvedValue([]);
    prismaMock.payOrder.count.mockResolvedValue(0);

    const r = await listOrdersForUser({ userId: BigInt(7), page: 2, status: "paid" });

    expect(r).toEqual({ items: [], total: 0, page: 2 });
    expect(prismaMock.payOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: BigInt(7), status: "paid" },
        skip: 15,
        take: 15,
        orderBy: { id: "desc" },
      }),
    );
    expect(prismaMock.payOrder.count).toHaveBeenCalledWith({
      where: { userId: BigInt(7), status: "paid" },
    });
  });

  it("status 为 null 时不带状态段;Decimal 与日期映射为字符串", async () => {
    prismaMock.payOrder.findMany.mockResolvedValue([
      {
        orderNo: "202610091200001234500000",
        status: "pending",
        amount: { toFixed: () => "5.00" },
        createdAt: new Date("2026-10-09T04:00:00Z"),
        paidAt: null,
        expiresAt: new Date("2026-10-09T05:00:00Z"),
        items: [{ title: "测试文章" }],
      },
    ]);
    prismaMock.payOrder.count.mockResolvedValue(1);

    const r = await listOrdersForUser({ userId: BigInt(7), page: 1, status: null });

    expect(prismaMock.payOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: BigInt(7) }, skip: 0, take: 15 }),
    );
    expect(r.items[0]).toMatchObject({
      orderNo: "202610091200001234500000",
      status: "pending",
      amount: "5.00",
      title: "测试文章",
      paidAt: null,
    });
    expect(r.items[0]?.createdAt).toBe("2026-10-09T04:00:00.000Z");
    expect(r.items[0]?.expiresAt).toBe("2026-10-09T05:00:00.000Z");
  });
});

describe("summarizeMonthUsage(costOfRow 口径)", () => {
  const prices: UsagePrices = {
    models: new Map([[1, { priceIn: 2, priceOut: 8, pricePerImage: null }]]),
    asrPricePerHour: null,
  };

  it("费用=tokensIn×入价+tokensOut×出价;failed 不计费仍计次数", () => {
    const s = summarizeMonthUsage(
      [
        {
          role: "agent",
          modelId: 1,
          modelKey: "glm-4",
          tokensIn: 1_000_000,
          tokensOut: 500_000,
          audioSeconds: 0,
          status: "ok",
        },
        {
          role: "agent",
          modelId: 1,
          modelKey: "glm-4",
          tokensIn: 10,
          tokensOut: 0,
          audioSeconds: 0,
          status: "failed",
        },
      ],
      prices,
    );
    expect(s.calls).toBe(2);
    expect(s.tokens).toBe(1_500_010);
    // ¥2×1 + ¥8×0.5 = ¥6(failed 行 0)
    expect(s.cost).toBeCloseTo(6, 6);
  });

  it("未定价模型按 0 折算", () => {
    const s = summarizeMonthUsage(
      [
        {
          role: "agent",
          modelId: 99,
          modelKey: "unknown",
          tokensIn: 1000,
          tokensOut: 1000,
          audioSeconds: 0,
          status: "ok",
        },
      ],
      prices,
    );
    expect(s.calls).toBe(1);
    expect(s.tokens).toBe(2000);
    expect(s.cost).toBe(0);
  });
});

describe("getMonthUsage(接线)", () => {
  it("月界过滤 + 牌价快照 + 聚合透传", async () => {
    prismaMock.aiUsageLog.findMany.mockResolvedValue([
      {
        role: "agent",
        modelId: 1,
        modelKey: "glm-4",
        tokensIn: 1000,
        tokensOut: 2000,
        audioSeconds: 0,
        status: "ok",
      },
    ]);
    prismaMock.aiModel.findMany.mockResolvedValue([
      { id: 1, priceIn: 2, priceOut: 8, pricePerImage: null },
    ]);
    prismaMock.asrConfig.findFirst.mockResolvedValue(null);

    const r: MonthUsageSummary = await import("../users/account-usage").then((m) =>
      m.getMonthUsage(BigInt(7)),
    );

    expect(prismaMock.aiUsageLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: BigInt(7), createdAt: { gte: expect.any(Date) } },
      }),
    );
    expect(r.periodKey).toMatch(/^\d{4}-\d{2}$/);
    expect(r.calls).toBe(1);
    expect(r.tokens).toBe(3000);
    // (1000×2 + 2000×8)/1M = ¥0.018
    expect(r.cost).toBeCloseTo(0.018, 6);
  });
});
