/**
 * 牌价按源批量下架单测(M76):只下架已上架行,人工定稿/待终审/已下架行跳过。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const modelFindMany = vi.fn();
const modelUpdateMany = vi.fn();
const planFindMany = vi.fn();
const planUpdateMany = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    modelPricing: {
      findMany: (...a: unknown[]) => modelFindMany(...a),
      updateMany: (...a: unknown[]) => modelUpdateMany(...a),
    },
    codingPlan: {
      findMany: (...a: unknown[]) => planFindMany(...a),
      updateMany: (...a: unknown[]) => planUpdateMany(...a),
    },
  },
}));

import { offlinePricingSource } from "./offline-source";

/** 聚合源圈行断言:模型表查询的 where 应按 provider.key 连行 + vendor 兜底 */
function assertAggregatorScope(): void {
  const arg = modelFindMany.mock.calls[0]![0] as { where?: { OR?: unknown[] } };
  expect(Array.isArray(arg.where?.OR)).toBe(true);
}

describe("offlinePricingSource(M76 按源批量下架)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelUpdateMany.mockResolvedValue({ count: 1 });
    planUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("只下架已上架行:待终审/已下架/人工定稿行跳过并带原因", async () => {
    modelFindMany.mockResolvedValue([
      { id: BigInt(1), modelKey: "hunyuan-a", status: "enabled", isPinned: false },
      { id: BigInt(2), modelKey: "hunyuan-b", status: "pending", isPinned: false },
      { id: BigInt(3), modelKey: "hunyuan-c", status: "disabled", isPinned: false },
      { id: BigInt(4), modelKey: "hunyuan-d", status: "enabled", isPinned: true },
    ]);
    const r = await offlinePricingSource({
      vendor: "腾讯云",
      target: "model",
      providerKey: "tencent-cloud",
    });
    expect(r.changed.map((c) => c.id)).toEqual(["1"]);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      "待终审,未上架",
      "已下架",
      "人工定稿行,采集不覆盖,不下架",
    ]);
    // 只对 enabled 且非定稿行落库(防竞态误改)
    expect(modelUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [BigInt(1)] }, status: "enabled", isPinned: false },
      data: { status: "disabled" },
    });
    expect(r.applied).toBe(1);
  });

  it("产出面=plan 时走套餐表,模型表不动", async () => {
    planFindMany.mockResolvedValue([
      { id: BigInt(7), planName: "Token Plan · Hy", status: "enabled", isPinned: false },
    ]);
    const r = await offlinePricingSource({
      vendor: "腾讯云",
      target: "plan",
      providerKey: "tencent-cloud",
    });
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0]).toMatchObject({ table: "plan", id: "7", name: "Token Plan · Hy" });
    expect(planUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [BigInt(7)] }, status: "enabled", isPinned: false },
      data: { status: "disabled" },
    });
    expect(modelFindMany).not.toHaveBeenCalled();
    expect(modelUpdateMany).not.toHaveBeenCalled();
  });

  it("M79 聚合源:模型表按 providerKey 圈行(OR 兜底未归一的 vendor 行)", async () => {
    modelFindMany.mockResolvedValue([
      { id: BigInt(1), modelKey: "kling-v3", status: "enabled", isPinned: false },
      { id: BigInt(2), modelKey: "glm-5.3", status: "enabled", isPinned: false },
    ]);
    modelUpdateMany.mockResolvedValue({ count: 2 });
    const r = await offlinePricingSource({
      vendor: "百度词元所",
      target: "model",
      providerKey: "baidu-ciyuansuo",
    });
    assertAggregatorScope();
    expect(r.applied).toBe(2);
    expect(r.changed.map((c) => c.name)).toEqual(["kling-v3", "glm-5.3"]);
  });

  it("没有可下架的行时不写库(幂等)", async () => {
    modelFindMany.mockResolvedValue([
      { id: BigInt(3), modelKey: "hunyuan-c", status: "disabled", isPinned: false },
    ]);
    const r = await offlinePricingSource({
      vendor: "腾讯云",
      target: "model",
      providerKey: "tencent-cloud",
    });
    expect(r.changed).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(modelUpdateMany).not.toHaveBeenCalled();
  });
});
