/**
 * 爆破防护单测:Redis 用内存 Map 替身,incr/expire 模拟自增与计数首次设 TTL。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const expires = new Map<string, number>();
vi.mock("@/lib/redis", () => ({
  redis: {
    get: async (k: string) => store.get(k) ?? null,
    del: async (k: string) => void store.delete(k),
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

import {
  ACCOUNT_FAIL_LIMIT,
  ACCOUNT_LOCK_SECONDS,
  clearAccountFails,
  IP_FAIL_LIMIT,
  IP_WINDOW_SECONDS,
  isAccountLocked,
  isIpBlocked,
  recordAccountFail,
  recordIpFail,
} from "./rate-limit";

describe("账号锁定(5 次锁 15min)", () => {
  beforeEach(() => {
    store.clear();
    expires.clear();
  });

  it("未达阈值不锁;第 5 次失败后锁定;成功后清零解锁", async () => {
    const phone = "13812341234";
    for (let i = 0; i < ACCOUNT_FAIL_LIMIT - 1; i++) await recordAccountFail(phone);
    expect(await isAccountLocked(phone)).toBe(false);
    await recordAccountFail(phone);
    expect(await isAccountLocked(phone)).toBe(true);
    expect(expires.get(`auth:fail:acct:${phone}`)).toBe(ACCOUNT_LOCK_SECONDS);
    await clearAccountFails(phone);
    expect(await isAccountLocked(phone)).toBe(false);
  });
});

describe("IP 日上限(50 次/日)", () => {
  beforeEach(() => {
    store.clear();
    expires.clear();
  });

  it("达上限判阻塞;空 IP 不计数不阻塞", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < IP_FAIL_LIMIT - 1; i++) await recordIpFail(ip);
    expect(await isIpBlocked(ip)).toBe(false);
    await recordIpFail(ip);
    expect(await isIpBlocked(ip)).toBe(true);
    expect(expires.get(`auth:fail:ip:${ip}`)).toBe(IP_WINDOW_SECONDS);

    expect(await isIpBlocked("")).toBe(false);
    await recordIpFail("");
    expect(store.has("auth:fail:ip:")).toBe(false);
  });
});
