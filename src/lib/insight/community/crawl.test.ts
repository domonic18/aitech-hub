/**
 * 社区采集编排纯逻辑单测(M58 批④,prisma/redis/logger mock 无真库):
 * 日预算截断口径(超预算截断、负余量归零、预算满不阻塞采集)。
 * 取数/落库/幂等走真机链路验收,不在此仿真。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/redis", () => ({ redis: {} }));

import { clampByQuota } from "./crawl";

describe("clampByQuota", () => {
  it("预算内全放行", () => {
    expect(clampByQuota(10, 0, 200)).toBe(10);
    expect(clampByQuota(30, 20, 50)).toBe(30);
  });

  it("超预算截断到余量", () => {
    expect(clampByQuota(80, 40, 50)).toBe(10);
  });

  it("预算已满/超额 → 0(本轮不入池,次日照常)", () => {
    expect(clampByQuota(20, 50, 50)).toBe(0);
    expect(clampByQuota(20, 60, 50)).toBe(0);
  });

  it("非法入参不产生负数", () => {
    expect(clampByQuota(0, 0, 50)).toBe(0);
    expect(clampByQuota(-3, 0, 50)).toBe(0);
  });
});
