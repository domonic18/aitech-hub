/**
 * guest-threads 单测(Redis 必 mock):g_ 前缀、绑定带 TTL、归属读取、
 * 续期容错、解绑归属校验。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.hoisted(() => vi.fn());
const setMock = vi.hoisted(() => vi.fn());
const expireMock = vi.hoisted(() => vi.fn());
const delMock = vi.hoisted(() => vi.fn());

vi.mock("../redis", () => ({
  redis: { get: getMock, set: setMock, expire: expireMock, del: delMock },
}));

import {
  GUEST_THREAD_PREFIX,
  GUEST_THREAD_TTL_SECONDS,
  bindGuestThread,
  getGuestThreadOwner,
  isGuestThreadId,
  newGuestThreadId,
  refreshGuestThread,
  unbindGuestThread,
} from "./guest-threads";

beforeEach(() => {
  getMock.mockReset().mockResolvedValue(null);
  setMock.mockReset().mockResolvedValue("OK");
  expireMock.mockReset().mockResolvedValue(1);
  delMock.mockReset().mockResolvedValue(1);
});

describe("thread id", () => {
  it("newGuestThreadId 出 g_<uuid>;isGuestThreadId 识别", () => {
    const id = newGuestThreadId();
    expect(id.startsWith(GUEST_THREAD_PREFIX)).toBe(true);
    expect(id).toMatch(/^g_[0-9a-f-]{36}$/);
    expect(isGuestThreadId(id)).toBe(true);
    expect(isGuestThreadId("0c8e5daa-0ab1-42e0-8c48-aa07f4dc9841")).toBe(false);
  });
});

describe("bind / owner / refresh / unbind", () => {
  it("绑定即写 Redis 带 2h TTL", async () => {
    await bindGuestThread("g_a", "v-1");
    expect(setMock).toHaveBeenCalledWith(
      "search:agent:gthread:g_a",
      "v-1",
      "EX",
      GUEST_THREAD_TTL_SECONDS,
    );
  });

  it("归属读取:命中返 owner,未命中 null", async () => {
    getMock.mockResolvedValue("v-1");
    await expect(getGuestThreadOwner("g_a")).resolves.toBe("v-1");
    getMock.mockResolvedValue(null);
    await expect(getGuestThreadOwner("g_gone")).resolves.toBeNull();
  });

  it("Redis 挂 → 归属读 null(fail-closed,调用方按 404)", async () => {
    getMock.mockRejectedValue(new Error("redis down"));
    await expect(getGuestThreadOwner("g_a")).resolves.toBeNull();
  });

  it("续期失败不抛(run 不反噬)", async () => {
    expireMock.mockRejectedValue(new Error("redis down"));
    await expect(refreshGuestThread("g_a")).resolves.toBeUndefined();
  });

  it("解绑:本人删键 true;非本人/键失 false 不删", async () => {
    getMock.mockResolvedValue("v-1");
    await expect(unbindGuestThread("g_a", "v-1")).resolves.toBe(true);
    expect(delMock).toHaveBeenCalledWith("search:agent:gthread:g_a");
    getMock.mockResolvedValue("v-other");
    await expect(unbindGuestThread("g_a", "v-1")).resolves.toBe(false);
    expect(delMock).toHaveBeenCalledTimes(1);
    getMock.mockResolvedValue(null);
    await expect(unbindGuestThread("g_gone", "v-1")).resolves.toBe(false);
  });
});
