/**
 * 牌价采集源健康度单测(M74 批C2):源与行的对应按 vendor(不靠 URL——
 * 渠道 URL 会被后台改)、状态分布汇总、每源最近一次快照。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sourceFindMany = vi.fn();
const groupBy = vi.fn();
const snapshotFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    crawlSource: { findMany: (...a: unknown[]) => sourceFindMany(...a) },
    modelPricing: { groupBy: (...a: unknown[]) => groupBy(...a) },
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
  ]);
  groupBy.mockImplementation(async (args: { where?: { note?: { contains?: string } } }) => {
    // 待复核查询(note 含【待复核)与状态分组查询分开返回
    if (args.where?.note?.contains !== undefined) {
      return [{ vendor: "硅基流动 SiliconFlow", _count: { _all: 4 } }];
    }
    return [
      { vendor: "DeepSeek 深度求索", status: "enabled", _count: { _all: 3 } },
      { vendor: "DeepSeek 深度求索", status: "pending", _count: { _all: 2 } },
      { vendor: "硅基流动 SiliconFlow", status: "pending", _count: { _all: 4 } },
      { vendor: "硅基流动 SiliconFlow", status: "disabled", _count: { _all: 1 } },
    ];
  });
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
  it("按 vendor 把行归到源(不靠 URL——渠道 URL 会被后台改)", async () => {
    const rows = await listPricingSourceHealth();
    expect(rows).toHaveLength(2);
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
