/**
 * 牌价采集源健康度单测(M74 批C2;M76 补产出面;M79 改 source-resolve 口径):
 * 源与行的对应按 providerKey + 产出面优先、vendor 兜底,状态分布汇总、每源最近快照。
 *
 * M76 回归点:同一 vendor 下有多个源(腾讯云=Token Plan 套餐 + 混元模型牌价),
 * 套餐源必须看套餐表、模型源看模型表——否则套餐源会把同厂商的模型行数
 * 误报成自己的产出。
 * M79 回归点:聚合源(词元所)一行多 vendor(词元所·XXX),按 providerKey 归源,
 * 否则其产出全部漏算。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sourceFindMany = vi.fn();
const modelFindMany = vi.fn();
const planFindMany = vi.fn();
const snapshotFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    crawlSource: { findMany: (...a: unknown[]) => sourceFindMany(...a) },
    modelPricing: { findMany: (...a: unknown[]) => modelFindMany(...a) },
    codingPlan: { findMany: (...a: unknown[]) => planFindMany(...a) },
    crawlSnapshot: { findMany: (...a: unknown[]) => snapshotFindMany(...a) },
  },
}));

import { listPricingSourceHealth } from "./health";

beforeEach(() => {
  vi.clearAllMocks();
  sourceFindMany.mockResolvedValue([
    {
      id: 1,
      name: "pricing:deepseek",
      url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
      enabled: true,
      crawlIntervalMin: 1440,
      status: "healthy",
      consecutiveFails: 0,
      lastRunAt: new Date("2026-11-15T02:00:00Z"),
      nextRunAt: new Date("2026-11-16T02:00:00Z"),
      remark: null,
    },
    {
      id: 2,
      name: "pricing:siliconflow-model",
      url: "https://siliconflow.cn/pricing",
      enabled: false,
      crawlIntervalMin: 1440,
      status: "error",
      consecutiveFails: 3,
      lastRunAt: null,
      nextRunAt: null,
      remark: null,
    },
    {
      id: 3,
      name: "pricing:tencent-tokenplan",
      url: "https://cloud.tencent.com/product/hunyuan/tokenplan",
      enabled: true,
      crawlIntervalMin: 10080,
      status: "degraded",
      consecutiveFails: 1,
      lastRunAt: new Date("2026-11-18T11:42:00Z"),
      nextRunAt: null,
      remark: null,
    },
    {
      id: 4,
      name: "pricing:tencent-hunyuan",
      url: "https://cloud.tencent.com/product/hunyuan/pricing",
      enabled: true,
      crawlIntervalMin: 1440,
      status: "healthy",
      consecutiveFails: 0,
      lastRunAt: new Date("2026-11-19T00:00:00Z"),
      nextRunAt: null,
      remark: null,
    },
    {
      id: 5,
      name: "pricing:baidu-ciyuansuo",
      url: "https://www.ciyuansuo.com/market",
      enabled: true,
      crawlIntervalMin: 1440,
      status: "healthy",
      consecutiveFails: 0,
      lastRunAt: new Date("2026-11-19T00:00:00Z"),
      nextRunAt: null,
      remark: null,
    },
  ]);
  const rep = <T>(n: number, row: T): T[] => Array.from({ length: n }, () => ({ ...row }));
  modelFindMany.mockResolvedValue([
    ...rep(3, {
      vendor: "DeepSeek 深度求索",
      status: "enabled",
      note: null,
      provider: { key: "deepseek" },
    }),
    ...rep(2, {
      vendor: "DeepSeek 深度求索",
      status: "pending",
      note: null,
      provider: { key: "deepseek" },
    }),
    ...rep(4, {
      vendor: "硅基流动 SiliconFlow",
      status: "pending",
      note: "【待复核 2026-11-18】x",
      provider: { key: "siliconflow" },
    }),
    ...rep(1, {
      vendor: "硅基流动 SiliconFlow",
      status: "disabled",
      note: null,
      provider: { key: "siliconflow" },
    }),
    ...rep(10, {
      vendor: "腾讯云",
      status: "enabled",
      note: null,
      provider: { key: "tencent-cloud" },
    }),
    // 聚合源(词元所)一行多 vendor,靠 providerKey 归源(M79 回归锚)
    ...rep(2, {
      vendor: "词元所·可灵 AI",
      status: "pending",
      note: null,
      provider: { key: "baidu-ciyuansuo" },
    }),
    ...rep(3, {
      vendor: "词元所·智谱",
      status: "enabled",
      note: null,
      provider: { key: "baidu-ciyuansuo" },
    }),
  ]);
  planFindMany.mockResolvedValue([
    ...rep(5, { vendor: "腾讯云", status: "enabled", note: "【待复核 2026-11-18】y" }),
    ...rep(3, { vendor: "腾讯云", status: "pending", note: "【待复核 2026-11-18】z" }),
  ]);
  snapshotFindMany.mockResolvedValue([
    {
      sourceId: 2,
      capturedAt: new Date("2026-11-15T03:00:00Z"),
      parseStatus: "failed",
      rowCount: null,
      error: "矩阵结构未匹配(页面可能改版)",
    },
  ]);
});

describe("listPricingSourceHealth", () => {
  it("按 providerKey/vendor 把行归到源(不靠 URL——渠道 URL 会被后台改)", async () => {
    const rows = await listPricingSourceHealth();
    expect(rows).toHaveLength(5);
    const deepseek = rows.find((r) => r.key === "deepseek")!;
    expect(deepseek.vendor).toBe("DeepSeek 深度求索");
    expect(deepseek.rows.enabled).toBe(3);
    expect(deepseek.rows.pending).toBe(2);
    expect(deepseek.rows.total).toBe(5);
  });

  it("待复核行数单列(与待终审 pending 分开)", async () => {
    const rows = await listPricingSourceHealth();
    const sf = rows.find((r) => r.key === "siliconflow-model")!;
    expect(sf.rows.recheck).toBe(4);
    expect(sf.rows.pending).toBe(4);
    expect(sf.rows.disabled).toBe(1);
  });

  it("同 vendor 的兄弟源不串行:套餐源看套餐表,模型源看模型表", async () => {
    const rows = await listPricingSourceHealth();
    const plan = rows.find((r) => r.key === "tencent-tokenplan")!;
    const model = rows.find((r) => r.key === "tencent-hunyuan")!;
    expect(plan.vendor).toBe("腾讯云");
    expect(model.vendor).toBe("腾讯云");
    expect(plan.target).toBe("plan");
    expect(model.target).toBe("model");
    // 套餐源只认套餐表的 8 行(5 上架 + 3 待终审),待复核 8 行也在套餐表
    expect(plan.rows.total).toBe(8);
    expect(plan.rows.enabled).toBe(5);
    expect(plan.rows.pending).toBe(3);
    expect(plan.rows.recheck).toBe(8);
    // 模型源只认模型表的 10 行,不混套餐的 8 行
    expect(model.rows.total).toBe(10);
    expect(model.rows.enabled).toBe(10);
    expect(model.rows.pending).toBe(0);
  });

  it("M79 聚合源:一行多 vendor(词元所·XXX)按 providerKey 归源,不再漏算", async () => {
    const rows = await listPricingSourceHealth();
    const cys = rows.find((r) => r.key === "baidu-ciyuansuo")!;
    expect(cys.providerKey).toBe("baidu-ciyuansuo");
    expect(cys.rows.total).toBe(5);
    expect(cys.rows.pending).toBe(2);
    expect(cys.rows.enabled).toBe(3);
  });

  it("最近一次采集快照:每源取最新一条 + 错误原文", async () => {
    const rows = await listPricingSourceHealth();
    const sf = rows.find((r) => r.key === "siliconflow-model")!;
    expect(sf.lastCapture?.parseStatus).toBe("failed");
    expect(sf.lastCapture?.error).toContain("矩阵结构未匹配");
    const ds = rows.find((r) => r.key === "deepseek")!;
    expect(ds.lastCapture).toBeNull();
  });

  it("源状态与停用/连败照实带出", async () => {
    const rows = await listPricingSourceHealth();
    const sf = rows.find((r) => r.key === "siliconflow-model")!;
    expect(sf.enabled).toBe(false);
    expect(sf.status).toBe("error");
    expect(sf.consecutiveFails).toBe(3);
  });

  it("没有牌价源时返回空数组", async () => {
    sourceFindMany.mockResolvedValue([]);
    expect(await listPricingSourceHealth()).toEqual([]);
  });
});
