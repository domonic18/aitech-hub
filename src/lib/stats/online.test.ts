/**
 * 在线用户 presence 单测(M28 批②;redis 必 mock):心跳管道命令序列与
 * member 形态、在线快照的按人归并(最后活跃页)/页面分布排序/空窗兜底。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const pipeMock = vi.hoisted(() => {
  const p: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const k of ["zadd", "zremrangebyscore", "expire", "exec"]) {
    p[k] = vi.fn();
  }
  for (const k of ["zadd", "zremrangebyscore", "expire"]) p[k]!.mockReturnValue(p);
  p.exec!.mockResolvedValue([]);
  return p;
});
const zrangebyscoreMock = vi.hoisted(() => vi.fn());
const redisMock = vi.hoisted(() => ({
  pipeline: vi.fn(() => pipeMock),
  zrangebyscore: zrangebyscoreMock,
}));

vi.mock("../redis", () => ({ redis: redisMock }));

import { getOnlinePresence, touchPresence } from "./online";

beforeEach(() => {
  for (const k of ["zadd", "zremrangebyscore", "expire", "exec"]) pipeMock[k]!.mockClear();
  zrangebyscoreMock.mockReset().mockResolvedValue([]);
});

describe("touchPresence(心跳管道)", () => {
  it("ZADD member=`vhash|path` + 5 分钟滑窗清理 + 键 TTL,一管道原子发出", async () => {
    const before = Date.now();
    await touchPresence("a".repeat(32), "/post/1-x/");
    const cutoffArg = pipeMock.zremrangebyscore.mock.calls[0]![2] as number;
    expect(pipeMock.zadd).toHaveBeenCalledWith(
      "stats:online",
      expect.any(Number),
      `${"a".repeat(32)}|/post/1-x/`,
    );
    expect(pipeMock.zadd.mock.calls[0]![1]).toBeGreaterThanOrEqual(before);
    // 清理下限 = now - 300s(允许毫秒级抖动)
    expect(cutoffArg).toBeLessThanOrEqual(before + 5);
    expect(before - cutoffArg).toBeGreaterThanOrEqual(299_000);
    expect(pipeMock.zremrangebyscore).toHaveBeenCalledWith("stats:online", "-inf", cutoffArg);
    expect(pipeMock.expire).toHaveBeenCalledWith("stats:online", 86_400);
    expect(pipeMock.exec).toHaveBeenCalledTimes(1);
  });
});

describe("getOnlinePresence(按人归并最后活跃页)", () => {
  const V1 = "1".repeat(32);
  const V2 = "2".repeat(32);

  it("同一访客多页面只算最后活跃(score 最大),页面分布按人数降序", async () => {
    zrangebyscoreMock.mockResolvedValue([
      `${V1}|/post/1-a/`,
      "1000",
      `${V1}|/post/2-b/`,
      "2000", // 更晚 → 该访客停留页归并到 2-b
      `${V2}|/post/1-a/`,
      "1500",
    ]);
    const out = await getOnlinePresence();
    expect(out.total).toBe(2);
    expect(out.pages).toEqual([
      { path: "/post/1-a/", users: 1 },
      { path: "/post/2-b/", users: 1 },
    ]);
  });

  it("path 含 '|' 不影响切片(vhash 定长 32 前缀)", async () => {
    zrangebyscoreMock.mockResolvedValue([`${V1}|/search?q=a|b`, "1000"]);
    const out = await getOnlinePresence();
    expect(out.total).toBe(1);
    expect(out.pages).toEqual([{ path: "/search?q=a|b", users: 1 }]);
  });

  it("同人数按路径字典序稳定;空窗返零", async () => {
    zrangebyscoreMock.mockResolvedValue([`${V1}|/b/`, "1000", `${V2}|/a/`, "1000"]);
    const out = await getOnlinePresence();
    expect(out.pages.map((p) => p.path)).toEqual(["/a/", "/b/"]);

    zrangebyscoreMock.mockResolvedValue([]);
    await expect(getOnlinePresence()).resolves.toEqual({ total: 0, pages: [] });
  });
});
