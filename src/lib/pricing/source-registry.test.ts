/**
 * 牌价渠道注册表单测(M56 批B;2026-10-29 渠道统一并入 crawl_source 后重构):
 * 渠道种子幂等(crawl_source 只补缺不改值,周期默认周级)/ 单渠道爬取
 * (config.pricingKey 路由解析器,按 target 落库,失败打待复核标再抛错,
 * crawlSource 通用 catch 记健康度)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const csUpsert = vi.fn();
const findModels = vi.fn();
const createModel = vi.fn();
const updateModel = vi.fn();
const findPlans = vi.fn();
const createPlan = vi.fn();
const updatePlan = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    crawlSource: {
      upsert: (...a: unknown[]) => csUpsert(...a),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    modelPricing: {
      findMany: (...a: unknown[]) => findModels(...a),
      create: (...a: unknown[]) => createModel(...a),
      update: (...a: unknown[]) => updateModel(...a),
    },
    codingPlan: {
      findMany: (...a: unknown[]) => findPlans(...a),
      create: (...a: unknown[]) => createPlan(...a),
      update: (...a: unknown[]) => updatePlan(...a),
    },
    // 快照档案(源码解析前落盘):单测不落盘,只验不阻断主流程
    crawlSnapshot: {
      create: vi.fn(async () => ({ id: BigInt(1) })),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async () => ({})),
    },
  },
}));

// 快照存储:单测用 no-op(真实现落 workspace/snapshots 或 COS)
vi.mock("../collect/snapshot-store", () => ({
  snapshotStore: {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
  },
  isCosSnapshotConfigured: () => false,
}));

import { SOURCE_DEFS, runPricingSourceCrawl, syncPricingChannels } from "./source-registry";

const NOW = new Date("2026-10-29T00:00:00Z");
const DS_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";

const DEEPSEEK_HTML = `<table><tr><td>百万tokens输入 （缓存命中） 空闲时段 0.02元 0.15元 高峰时段 0.04元 0.30元 百万tokens输入 （缓存未命中） 空闲时段 1元 4.5元 高峰时段 2元 9.0元 百万tokens输出 空闲时段 4元 13.5元 高峰时段 8元 27.0元</td></tr></table>`;

beforeEach(() => {
  vi.clearAllMocks();
  csUpsert.mockResolvedValue({ id: 1 });
  findModels.mockResolvedValue([]);
  findPlans.mockResolvedValue([]);
  createModel.mockResolvedValue({ id: BigInt(1) });
  createPlan.mockResolvedValue({ id: BigInt(2) });
});

describe("syncPricingChannels", () => {
  it("按注册表逐个 upsert 进 crawl_source:pricing 类型/周级周期/config 带 key;只补缺不改值", async () => {
    const n = await syncPricingChannels();
    expect(n).toBe(SOURCE_DEFS.length);
    expect(csUpsert).toHaveBeenCalledTimes(SOURCE_DEFS.length);
    const first = csUpsert.mock.calls[0]![0] as {
      where: { name: string };
      update: Record<string, unknown>;
      create: {
        name: string;
        type: string;
        url: string;
        crawlIntervalMin: number;
        config: { pricingKey: string };
        enabled: boolean;
      };
    };
    expect(first.where.name).toBe(`pricing:${SOURCE_DEFS[0]!.key}`);
    expect(Object.keys(first.update)).toHaveLength(0); // url/启停/周期归后台
    expect(first.create.type).toBe("pricing");
    expect(first.create.crawlIntervalMin).toBe(10_080); // 周级,不天天采集
    expect(first.create.config).toEqual({ pricingKey: SOURCE_DEFS[0]!.key });
  });
});

describe("runPricingSourceCrawl", () => {
  it("config.pricingKey 路由解析器:取数+解析+按 target 落库", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(DEEPSEEK_HTML, { status: 200 })) as typeof fetch;
    try {
      const r = await runPricingSourceCrawl(
        { id: 42, url: DS_URL, config: { pricingKey: "deepseek" } },
        NOW,
      );
      expect(r).toEqual({ ok: true, fetched: 2 });
      expect(createModel).toHaveBeenCalledTimes(2);
      const created = createModel.mock.calls[0]![0] as {
        data: { sourceUrl: string; status: string };
      };
      expect(created.data.sourceUrl).toBe(DS_URL); // URL 来自 crawl_source 行(后台可调)
      expect(created.data.status).toBe("pending");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("失败:该源旧数据先打待复核标再抛错(crawlSource catch 记健康度)", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response("busy", { status: 503 })) as typeof fetch;
    try {
      findModels.mockResolvedValue([{ id: BigInt(9), note: null }]);
      updateModel.mockResolvedValue({ id: BigInt(9) });
      await expect(
        runPricingSourceCrawl({ id: 42, url: DS_URL, config: { pricingKey: "deepseek" } }, NOW),
      ).rejects.toThrow(/http 503[\s\S]*已标待复核 1 行/);
      expect((updateModel.mock.calls[0]![0] as { data: { note: string } }).data.note).toBe(
        "【待复核 2026-10-29 爬取失败】",
      );
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("config 无 key / key 未注册:抛错指认(可见故障)", async () => {
    await expect(runPricingSourceCrawl({ id: 42, url: DS_URL, config: {} }, NOW)).rejects.toThrow(
      "无注册解析器",
    );
    await expect(
      runPricingSourceCrawl({ id: 42, url: DS_URL, config: { pricingKey: "nope" } }, NOW),
    ).rejects.toThrow("无注册解析器");
  });
});
