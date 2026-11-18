/**
 * 降价史公开读侧单测(M74 批F,prisma mock 无真库):查询口径
 * (只取 drop + 近 90 天 + 关联行 enabled)+ 条数上限 + 降幅与展示名映射。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const count = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    modelPricingChange: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: (...a: unknown[]) => count(...a),
    },
  },
}));
vi.mock("@/lib/prerender-safe", () => ({
  prerenderSafe: (_e: string, _f: unknown, fn: () => Promise<unknown>) => fn(),
}));

import { listPublicPriceChanges } from "./changes-read";

const NOW = new Date("2026-11-18T04:00:00Z");

/** 库行形状(model_pricing_change + 关联 pricing/provider) */
function changeRow(over: Record<string, unknown>) {
  return {
    id: BigInt(1),
    modelPricingId: BigInt(7),
    vendor: "词元所·博川科技",
    modelKey: "qwen3-235b-a22b",
    oldInputPrice: 12,
    oldOutputPrice: 48,
    newInputPrice: 6,
    newOutputPrice: 24,
    oldCurrency: "CNY",
    newCurrency: "CNY",
    oldPriceUnit: "per_1m_tokens",
    newPriceUnit: "per_1m_tokens",
    changeKind: "drop",
    sourceKey: "baidu-ciyuansuo",
    sourceUrl: "https://cysuo.com/market",
    changedAt: new Date("2026-11-17T02:00:00Z"),
    pricing: {
      status: "enabled",
      provider: { key: "baidu-ciyuansuo", name: "百度词元所", sourceKind: "aggregator" },
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  count.mockResolvedValue(1);
  findMany.mockResolvedValue([changeRow({})]);
});

describe("listPublicPriceChanges", () => {
  it("查询口径:drop + 近 90 天 + 关联行 enabled;上限 100", async () => {
    const out = await listPublicPriceChanges({ now: NOW });
    const where = findMany.mock.calls[0]![0] as { where: Record<string, unknown>; take: number };
    expect(where.where).toMatchObject({
      changeKind: "drop",
      pricing: { status: "enabled" },
    });
    const changedAt = where.where.changedAt as { gte: Date };
    expect(changedAt.gte.getTime()).toBe(NOW.getTime() - 90 * 24 * 3600 * 1000);
    expect(where.take).toBe(100);
    expect(out.total).toBe(1);
  });

  it("映射:降幅百分比(代表价口径)+ 聚合源显示名回落 vendor + 渠道标签", async () => {
    const out = await listPublicPriceChanges({ now: NOW });
    const item = out.items[0]!;
    expect(item.providerName).toBe("词元所·博川科技"); // aggregator → 行内 vendor
    expect(item.dropPct).toBeCloseTo(50, 6); // 12 → 6
    expect(item.sourceLabel).toBe("百度词元所 聚合报价");
    expect(item.changedAt).toBe("2026-11-17"); // 北京日界
  });

  it("官方源显示名用字典名;旧价为 0 时 dropPct=null", async () => {
    findMany.mockResolvedValue([
      changeRow({
        vendor: "DeepSeek 深度求索",
        sourceKey: "deepseek",
        oldInputPrice: 0,
        oldOutputPrice: 0,
        pricing: {
          status: "enabled",
          provider: { key: "deepseek", name: "DeepSeek 深度求索", sourceKind: "official" },
        },
      }),
    ]);
    const out = await listPublicPriceChanges({ now: NOW });
    expect(out.items[0]!.providerName).toBe("DeepSeek 深度求索");
    expect(out.items[0]!.dropPct).toBeNull();
  });

  it("认不出的源键不显示标签(null,不猜)", async () => {
    findMany.mockResolvedValue([changeRow({ sourceKey: "ghost-source" })]);
    const out = await listPublicPriceChanges({ now: NOW });
    expect(out.items[0]!.sourceLabel).toBeNull();
  });
});
