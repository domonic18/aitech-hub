/**
 * 在线用户 presence 单测(M28 批②;redis 必 mock):心跳管道命令序列与 member
 * 形态(u:/g: 标识段、label 清洗)、在线快照的按人归并(最后活跃一条)/标识与
 * 路径解析(path 含 '|'、旧格式兜底)/最后活跃在前排序/空窗兜底。
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
  it("ZADD member=`vhash|u:标识|path` + 5 分钟滑窗清理 + 键 TTL,一管道原子发出", async () => {
    const before = Date.now();
    await touchPresence("a".repeat(32), "/post/1-x/", { kind: "user", label: "alice" });
    const cutoffArg = pipeMock.zremrangebyscore.mock.calls[0]![2] as number;
    expect(pipeMock.zadd).toHaveBeenCalledWith(
      "stats:online",
      expect.any(Number),
      `${"a".repeat(32)}|u:alice|/post/1-x/`,
    );
    expect(pipeMock.zadd.mock.calls[0]![1]).toBeGreaterThanOrEqual(before);
    // 清理下限 = now - 300s(允许毫秒级抖动)
    expect(cutoffArg).toBeLessThanOrEqual(before + 5);
    expect(before - cutoffArg).toBeGreaterThanOrEqual(299_000);
    expect(pipeMock.zremrangebyscore).toHaveBeenCalledWith("stats:online", "-inf", cutoffArg);
    expect(pipeMock.expire).toHaveBeenCalledWith("stats:online", 86_400);
    expect(pipeMock.exec).toHaveBeenCalledTimes(1);
  });

  it("未登录 guest 落 IP;label 内 '|' 清洗、超长截 100(防撑大 member)", async () => {
    await touchPresence("b".repeat(32), "/search", { kind: "guest", label: "192.168.1.9" });
    expect(pipeMock.zadd).toHaveBeenCalledWith(
      "stats:online",
      expect.any(Number),
      `${"b".repeat(32)}|g:192.168.1.9|/search`,
    );

    await touchPresence("c".repeat(32), "/", { kind: "user", label: "bad|name|x" });
    expect(pipeMock.zadd.mock.calls[1]![2] as string).toBe(`${"c".repeat(32)}|u:badnamex|/`);

    await touchPresence("d".repeat(32), "/", { kind: "user", label: "n".repeat(300) });
    const member = pipeMock.zadd.mock.calls[2]![2] as string;
    expect(member.startsWith(`${"d".repeat(32)}|u:${"n".repeat(100)}|/`)).toBe(true);
  });
});

describe("getOnlinePresence(按人归并最后活跃一条)", () => {
  const V1 = "1".repeat(32);
  const V2 = "2".repeat(32);

  it("同一访客多页面只留最后活跃(score 最大),列表按最后活跃在前", async () => {
    zrangebyscoreMock.mockResolvedValue([
      `${V1}|u:alice|/post/1-a/`,
      "1000",
      `${V1}|u:alice|/post/2-b/`,
      "2000", // 更晚 → 归并到 2-b
      `${V2}|g:10.0.0.1|/`,
      "1500",
    ]);
    const out = await getOnlinePresence();
    expect(out.total).toBe(2);
    expect(out.visitors).toEqual([
      { kind: "user", label: "alice", path: "/post/2-b/", lastActiveMs: 2000 },
      { kind: "guest", label: "10.0.0.1", path: "/", lastActiveMs: 1500 },
    ]);
  });

  it("path 含 '|' 不影响解析(标识段按首个 '|' 切,path 居末段)", async () => {
    zrangebyscoreMock.mockResolvedValue([`${V1}|g:198.51.100.7|/search?q=a|b`, "1000"]);
    const out = await getOnlinePresence();
    expect(out.total).toBe(1);
    expect(out.visitors).toEqual([
      { kind: "guest", label: "198.51.100.7", path: "/search?q=a|b", lastActiveMs: 1000 },
    ]);
  });

  it("旧格式成员(vhash|path 无标识段)兜底匿名空标识", async () => {
    zrangebyscoreMock.mockResolvedValue([`${V1}|/post/9-legacy/`, "1000"]);
    const out = await getOnlinePresence();
    expect(out.visitors).toEqual([
      { kind: "guest", label: "", path: "/post/9-legacy/", lastActiveMs: 1000 },
    ]);
  });

  it("空窗返零", async () => {
    zrangebyscoreMock.mockResolvedValue([]);
    await expect(getOnlinePresence()).resolves.toEqual({ total: 0, visitors: [] });
  });
});
