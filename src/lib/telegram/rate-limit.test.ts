/**
 * 每日请求上限单测:Redis 用内存 Map 替身(同 auth/rate-limit 测试口径)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const expires = new Map<string, number>();
vi.mock("@/lib/redis", () => ({
  redis: {
    incr: async (k: string) => {
      const n = Number(store.get(k) ?? "0") + 1;
      store.set(k, String(n));
      return n;
    },
    expire: async (k: string, sec: number) => {
      expires.set(k, sec);
      return 1;
    },
  },
}));

import { dailyRequestKey, tryConsumeDailyQuota } from "./rate-limit";

beforeEach(() => {
  store.clear();
  expires.clear();
});

describe("dailyRequestKey", () => {
  it("按来源与统计日切分", () => {
    expect(dailyRequestKey(3, "2026-10-03")).toBe("crawler:req:3:2026-10-03");
  });
});

describe("tryConsumeDailyQuota", () => {
  it("未超限放行,超限拒答", async () => {
    expect(await tryConsumeDailyQuota(1, 3)).toBe(true);
    expect(await tryConsumeDailyQuota(1, 3)).toBe(true);
    expect(await tryConsumeDailyQuota(1, 3)).toBe(true);
    expect(await tryConsumeDailyQuota(1, 3)).toBe(false); // 第 4 次 > 上限 3
  });

  it("首次计数设 48h TTL", async () => {
    await tryConsumeDailyQuota(7, 1);
    expect(expires.get(dailyRequestKey(7))).toBe(48 * 3600); // 默认参数同实现口径
  });

  it("各来源计数独立", async () => {
    await tryConsumeDailyQuota(1, 1);
    expect(await tryConsumeDailyQuota(2, 1)).toBe(true);
    expect(await tryConsumeDailyQuota(1, 1)).toBe(false);
  });
});
