/**
 * 绑定解析单测:pickBoundModel 纯函数(主力优先/停用回落/双停用 null)
 * + getRoleDailyMax 配额读侧(M9 批⑥:行缺/dailyMax null → 默认 100 兜底)。
 */
import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  aiTaskBinding: { findUnique: vi.fn<(args?: unknown) => Promise<unknown>>() },
}));
vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../env", () => ({ env: { AUTH_SECRET: "unit-test-auth-secret-0123456789" } }));

import { DEFAULT_DAILY_MAX, getRoleDailyMax, pickBoundModel } from "./resolver";

describe("pickBoundModel", () => {
  it("主力启用 → primary;主力停用 → backup;主力缺失 → backup", () => {
    expect(pickBoundModel({ enabled: true }, { enabled: true })).toBe("primary");
    expect(pickBoundModel({ enabled: false }, { enabled: true })).toBe("backup");
    expect(pickBoundModel(null, { enabled: true })).toBe("backup");
  });

  it("主力缺失且备用停用/双 null → null(消费方降级)", () => {
    expect(pickBoundModel(null, { enabled: false })).toBeNull();
    expect(pickBoundModel({ enabled: false }, null)).toBeNull();
    expect(pickBoundModel(null, null)).toBeNull();
  });
});

describe("getRoleDailyMax(M9 批⑥ 后台配额)", () => {
  it("行有 dailyMax → 该值;行缺/null → 默认 100", async () => {
    prismaMock.aiTaskBinding.findUnique.mockResolvedValueOnce({ dailyMax: 25 });
    expect(await getRoleDailyMax("interpret")).toBe(25);
    prismaMock.aiTaskBinding.findUnique.mockResolvedValueOnce({ dailyMax: null });
    expect(await getRoleDailyMax("interpret")).toBe(DEFAULT_DAILY_MAX);
    prismaMock.aiTaskBinding.findUnique.mockResolvedValueOnce(null);
    expect(await getRoleDailyMax("summarize")).toBe(DEFAULT_DAILY_MAX);
  });
});
