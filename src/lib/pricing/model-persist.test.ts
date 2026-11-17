/**
 * 模型面落库单测(M74 批B,prisma mock 无真库):落库三规则(建 pending / 可刷新
 * 行刷新 / 人工定稿行不动)+ 归一关联(厂商/模型 get-or-create)+ 免费标识 +
 * 档位写入 + 下线墓碑。
 * 解析规则在 crawlers.test / model-sources/*.test;编排在 source-registry.test。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const create = vi.fn();
const update = vi.fn();
const providerFindUnique = vi.fn();
const providerCreate = vi.fn();
const modelFindFirst = vi.fn();
const modelCreate = vi.fn();
const modelUpdate = vi.fn();
const tierDeleteMany = vi.fn();
const tierCreateMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      fn({
        modelPricingTier: {
          deleteMany: (...a: unknown[]) => tierDeleteMany(...a),
          createMany: (...a: unknown[]) => tierCreateMany(...a),
        },
      }),
    modelPricing: {
      findMany: (...a: unknown[]) => findMany(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    modelPricingProvider: {
      findUnique: (...a: unknown[]) => providerFindUnique(...a),
      create: (...a: unknown[]) => providerCreate(...a),
    },
    modelPricingModel: {
      findFirst: (...a: unknown[]) => modelFindFirst(...a),
      create: (...a: unknown[]) => modelCreate(...a),
      update: (...a: unknown[]) => modelUpdate(...a),
    },
  },
  isP2002: (e: unknown): boolean =>
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002",
}));

import { parseDeepseek } from "./crawlers";
import {
  isFreeModelRow,
  markMissingModelsStale,
  persistModelRows,
  PRICING_TOMBSTONE_STALE_MS,
} from "./model-persist";

const NOW = new Date("2026-10-28T00:00:00Z");
const DS_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";

/** 按 2026-10-28 真实页面文本折叠形(去 tag 后)构造 */
const DEEPSEEK_HTML = `<p>下表所列模型价格以"百万 tokens"为单位。</p>
<table><tr><td>百万tokens输入 （缓存命中） 空闲时段 0.02元 0.15元 高峰时段 0.04元 0.30元 百万tokens输入 （缓存未命中） 空闲时段 1元 4.5元 高峰时段 2元 9.0元 百万tokens输出 空闲时段 4元 13.5元 高峰时段 8元 27.0元</td></tr></table>`;

beforeEach(() => {
  vi.clearAllMocks();
  providerFindUnique.mockResolvedValue({ id: BigInt(100), key: "deepseek", name: "x" });
  modelFindFirst.mockResolvedValue({
    id: BigInt(200),
    modelKey: "m",
    matchKey: "m",
    modality: "text",
  });
  tierCreateMany.mockResolvedValue({ count: 6 });
  update.mockResolvedValue({ id: BigInt(7) });
  create.mockResolvedValue({ id: BigInt(2) });
});

const rows = parseDeepseek(DEEPSEEK_HTML, DS_URL, NOW);

describe("persistModelRows 落库规则", () => {
  it("不存在→建 pending;可刷新行→刷新(currency 随价格走);人工定稿行→不动", async () => {
    findMany.mockResolvedValue([
      {
        id: BigInt(7),
        vendor: "DeepSeek 深度求索",
        modelKey: "deepseek-flash",
        status: "pending",
        isPinned: false,
      },
      {
        id: BigInt(8),
        vendor: "DeepSeek 深度求索",
        modelKey: "deepseek-v4-pro",
        status: "enabled",
        isPinned: true,
      },
    ]);
    const t = await persistModelRows(rows);
    expect(t).toMatchObject({ created: 0, refreshed: 1, untouched: 1, failed: 0 });
    const upd = update.mock.calls[0]![0] as {
      where: { id: bigint };
      data: { status?: string; currency?: string };
    };
    expect(upd.where.id).toBe(BigInt(7));
    expect(upd.data.status).toBeUndefined(); // 刷新不触状态机
    expect(upd.data.currency).toBe("CNY"); // currency 随价格走(跨通道脏态防线)
  });

  it("人工定稿闸只看 is_pinned:展示态不再决定覆盖与否(M73)", async () => {
    findMany.mockResolvedValue([
      {
        id: BigInt(8),
        vendor: "DeepSeek 深度求索",
        modelKey: "deepseek-v4-pro",
        status: "enabled",
        isPinned: false,
      },
    ]);
    const t1 = await persistModelRows(rows);
    expect(t1).toMatchObject({ refreshed: 1, untouched: 0 });

    // disabled 但未定稿 → 同样刷新(停用展示的行也要保持数据新鲜)
    findMany.mockResolvedValue([
      {
        id: BigInt(8),
        vendor: "DeepSeek 深度求索",
        modelKey: "deepseek-v4-pro",
        status: "disabled",
        isPinned: false,
      },
    ]);
    const t2 = await persistModelRows(rows);
    expect(t2).toMatchObject({ refreshed: 1, untouched: 0 });

    // 人工定稿 → 不碰(即便仍是 pending)
    findMany.mockResolvedValue([
      {
        id: BigInt(7),
        vendor: "DeepSeek 深度求索",
        modelKey: "deepseek-flash",
        status: "pending",
        isPinned: true,
      },
    ]);
    const t3 = await persistModelRows(rows);
    expect(t3).toMatchObject({ refreshed: 0, untouched: 1 });
  });

  it("陌生模型→create 落 pending;单行落库失败自吞计数", async () => {
    findMany.mockResolvedValue([]);
    create.mockRejectedValueOnce(new Error("db boom")).mockResolvedValue({ id: BigInt(2) });
    const t = await persistModelRows(rows);
    expect(t).toMatchObject({ created: 1, failed: 1 });
    const arg = create.mock.calls[1]![0] as { data: { status: string; currency: string } };
    expect(arg.data.status).toBe("pending");
    expect(arg.data.currency).toBe("CNY");
  });

  it("M74:落库带归一 id(厂商/模型字典)与免费标识", async () => {
    findMany.mockResolvedValue([]);
    await persistModelRows(rows);
    const arg = create.mock.calls[0]![0] as {
      data: { providerId: bigint | null; modelId: bigint | null; isFree: boolean };
    };
    expect(arg.data.providerId).toBe(BigInt(100));
    expect(arg.data.modelId).toBe(BigInt(200));
    expect(arg.data.isFree).toBe(false); // DeepSeek 有价,非完全免费
  });

  it("批G:行级计价单位随行写入,缺省 per_1m_tokens;刷新同样覆盖", async () => {
    findMany.mockResolvedValue([
      {
        id: BigInt(7),
        vendor: "DeepSeek 深度求索",
        modelKey: "deepseek-flash",
        status: "pending",
        isPinned: false,
      },
    ]);
    await persistModelRows(rows);
    const createdArg = create.mock.calls[0]![0] as { data: { priceUnit: string } };
    expect(createdArg.data.priceUnit).toBe("per_1m_tokens"); // 未显式给的行缺省 token
    const updatedArg = update.mock.calls[0]![0] as { data: { priceUnit: string } };
    expect(updatedArg.data.priceUnit).toBe("per_1m_tokens");

    const imageRows = rows.map((r) => ({
      ...r,
      modelKey: "doubao-seedream-4-0",
      priceUnit: "per_image",
      inputPrice: null,
    }));
    findMany.mockResolvedValue([]);
    await persistModelRows(imageRows);
    const arg2 = create.mock.calls.at(-1)![0] as { data: { priceUnit: string } };
    expect(arg2.data.priceUnit).toBe("per_image");
  });

  it("M74:档位随行写入(整行替换)", async () => {
    findMany.mockResolvedValue([]);
    await persistModelRows(rows);
    expect(tierDeleteMany).toHaveBeenCalled();
    const data = (tierCreateMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> })
      .data;
    expect(data).toHaveLength(6); // 缓存命中×谷/峰 + 输入×谷/峰 + 输出×谷/峰
    expect(data[0]).toMatchObject({ tierLabel: "缓存命中·空闲", cachePrice: 0.02 });
  });
});

describe("isFreeModelRow", () => {
  it("缺价不当免费;全零才算完全免费", () => {
    expect(
      isFreeModelRow({
        vendor: "v",
        modelKey: "m",
        currency: "CNY",
        inputPrice: null,
        outputPrice: null,
        contextWindow: null,
        note: "",
        dataAsOf: NOW,
        sourceUrl: "u",
        region: "cn",
      }),
    ).toBe(false);
    expect(
      isFreeModelRow({
        vendor: "v",
        modelKey: "m",
        currency: "CNY",
        inputPrice: 0,
        outputPrice: 0,
        contextWindow: null,
        note: "",
        dataAsOf: NOW,
        sourceUrl: "u",
        region: "cn",
      }),
    ).toBe(true);
  });

  it("档位里出现非零价 → 整行不算免费", () => {
    expect(
      isFreeModelRow({
        vendor: "v",
        modelKey: "m",
        currency: "CNY",
        inputPrice: 0,
        outputPrice: 0,
        contextWindow: null,
        note: "",
        dataAsOf: NOW,
        sourceUrl: "u",
        region: "cn",
        tiers: [
          {
            tierLabel: "缓存命中",
            inputPrice: null,
            outputPrice: null,
            cachePrice: 0.1,
            minTokens: null,
            maxTokens: null,
            unit: "per_1m_tokens",
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("markMissingModelsStale 墓碑", () => {
  it("多轮未出现的行→停用 + 打「源已下线」;人工定稿行不参与", async () => {
    findMany.mockResolvedValue([
      { id: BigInt(5), note: "[官方页爬虫] 旧行" },
      { id: BigInt(6), note: null },
    ]);
    const n = await markMissingModelsStale(DS_URL, NOW, PRICING_TOMBSTONE_STALE_MS);
    expect(n).toBe(2);
    const where = (findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.isPinned).toBe(false); // 人工定稿行不参与墓碑
    expect(where.status).toEqual({ not: "disabled" });
    const upd = update.mock.calls[0]![0] as { data: { status: string; note: string } };
    expect(upd.data.status).toBe("disabled");
    expect(upd.data.note).toContain("源已下线");
  });
});
