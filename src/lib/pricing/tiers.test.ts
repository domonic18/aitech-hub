/**
 * 牌价档位表单测(M74 批A):整行档位替换(删旧建新,单事务)与批量读。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteMany = vi.fn();
const createMany = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      fn({
        modelPricingTier: {
          deleteMany: (...a: unknown[]) => deleteMany(...a),
          createMany: (...a: unknown[]) => createMany(...a),
        },
      }),
    modelPricingTier: {
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

import { readTiers, replaceTiers } from "./tiers";

const NOW = new Date("2026-11-15T00:00:00Z");
const ID = BigInt(42);

beforeEach(() => {
  vi.clearAllMocks();
  deleteMany.mockResolvedValue({ count: 0 });
  createMany.mockResolvedValue({ count: 2 });
});

describe("replaceTiers", () => {
  it("删旧建新:先清该行旧档位再批量建", async () => {
    const n = await replaceTiers(ID, [
      {
        tierLabel: "默认",
        inputPrice: 1,
        outputPrice: 2,
        currency: "CNY",
        dataAsOf: NOW,
        sourceUrl: "https://example.com",
      },
      {
        tierLabel: "缓存命中",
        cachePrice: 0.1,
        currency: "CNY",
        dataAsOf: NOW,
        sourceUrl: "https://example.com",
      },
    ]);
    expect(n).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { modelPricingId: ID } });
    const data = (createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data;
    expect(data).toHaveLength(2);
    expect(data[0]!.unit).toBe("per_1m_tokens");
    expect(data[1]!.cachePrice).toBe(0.1);
    expect(data[1]!.inputPrice).toBeNull();
  });

  it("空档位集只删不建(不报空数组错)", async () => {
    const n = await replaceTiers(ID, []);
    expect(n).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("readTiers", () => {
  it("按牌价行分组返回,Decimal 转 number", async () => {
    findMany.mockResolvedValue([
      {
        modelPricingId: ID,
        tierLabel: "默认",
        inputPrice: { toString: () => "1.5" },
        outputPrice: null,
        cachePrice: null,
        minTokens: null,
        maxTokens: null,
        unit: "per_1m_tokens",
        currency: "CNY",
        dataAsOf: NOW,
        sourceUrl: "https://example.com",
        note: null,
      },
    ]);
    const map = await readTiers([ID]);
    const rows = map.get(ID.toString());
    expect(rows).toHaveLength(1);
    expect(rows![0]!.inputPrice).toBe(1.5);
    expect(rows![0]!.outputPrice).toBeNull();
  });

  it("空入参不查库", async () => {
    const map = await readTiers([]);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
