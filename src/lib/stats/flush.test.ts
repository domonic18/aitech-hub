/**
 * 统计缓冲落库单测(M48 批G 补盲;prisma/redis 必 mock):RENAME 私有键生命周期、
 * 六类键分发(visit 全零剪除/post 负计数剪除/geo 非法面剔除)、失败合并回数据键不计数。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => {
  const pipe = { hincrby: vi.fn(), expire: vi.fn(), exec: vi.fn(async () => []) };
  pipe.hincrby.mockReturnValue(pipe);
  pipe.expire.mockReturnValue(pipe);
  return {
    scan: vi.fn(),
    rename: vi.fn(),
    hgetall: vi.fn(),
    del: vi.fn(),
    expire: vi.fn(),
    pipeline: vi.fn(() => pipe),
    pipe,
  };
});
vi.mock("@/lib/redis", () => ({ redis: redisMock }));

const executeRaw = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    // $executeRaw 以标签模板调用;批G 断言只看参数值(day/pv/uv),不比 SQL 文本
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
    $transaction: async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : arg),
  },
}));

import { flushStatsBuffer } from "./flush";

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.scan.mockResolvedValue(["0", []]);
  redisMock.rename.mockResolvedValue("OK");
  redisMock.hgetall.mockResolvedValue({});
  redisMock.del.mockResolvedValue(1);
  redisMock.expire.mockResolvedValue(1);
  executeRaw.mockResolvedValue(1);
});

/** 驱动一次 flush,返回某键的 hgetall 假数据 */
function keysOf(...keys: string[]): void {
  redisMock.scan.mockResolvedValue(["0", keys]);
}

describe("flushStatsBuffer 生命周期", () => {
  it("扫描→RENAME 私有键→聚合→DEL,summary 计数正确", async () => {
    keysOf("stats:buf:visit:2026-10-25", "stats:buf:post:2026-10-25");
    redisMock.hgetall.mockImplementation(async (key: string) =>
      key.includes("visit") ? { pv: "3", uv: "2" } : { "12": "4" },
    );
    const summary = await flushStatsBuffer();
    expect(summary).toEqual({ keysFlushed: 2, postRows: 1 });
    // RENAME 目标是 stats:flushing:* 私有键
    expect(redisMock.rename).toHaveBeenCalledTimes(2);
    const [, tmp] = redisMock.rename.mock.calls[0]!;
    expect(String(tmp)).toMatch(/^stats:flushing:/);
    expect(redisMock.del).toHaveBeenCalledTimes(2);
  });

  it("RENAME 失败(键已被处理/过期)→ 跳过不计数", async () => {
    keysOf("stats:buf:visit:2026-10-25");
    redisMock.rename.mockRejectedValueOnce(new Error("ERR no such key"));
    const summary = await flushStatsBuffer();
    expect(summary).toEqual({ keysFlushed: 0, postRows: 0 });
    expect(redisMock.hgetall).not.toHaveBeenCalled();
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it("私有键落 5 分钟 TTL:崩溃在 DEL 之前也不会以 48h 级寿命残留(issue #202)", async () => {
    keysOf("stats:buf:post:2026-10-25");
    redisMock.hgetall.mockResolvedValue({ "12": "4" });
    await flushStatsBuffer();
    const [, tmp] = redisMock.rename.mock.calls[0]!;
    expect(redisMock.expire).toHaveBeenCalledWith(tmp, 300);
  });

  it("聚合失败 → 计数字段合并回数据键(RENAME 会覆盖期间新写入),不计 keysFlushed", async () => {
    keysOf("stats:buf:visit:2026-10-25", "stats:buf:ref:2026-10-25");
    redisMock.hgetall.mockImplementation(async (key: string) => {
      if (key.includes("visit")) throw new Error("db down");
      return { "direct|google|pv": "1" };
    });
    const summary = await flushStatsBuffer();
    expect(summary.keysFlushed).toBe(1);
    // 还原方向:不再 rename 回原键
    expect(
      redisMock.rename.mock.calls.some(
        (c) => String(c[0]).startsWith("stats:flushing:") && String(c[1]).startsWith("stats:buf:"),
      ),
    ).toBe(false);
    // 数据键重新钉回缓冲兜底 TTL,下轮 SCAN 可重试
    expect(redisMock.pipe.expire).toHaveBeenCalledWith("stats:buf:visit:2026-10-25", 172800);
  });

  it("聚合写库失败 → 已读出的计数字段逐项 HINCRBY 合并回原键,不丢本轮事件", async () => {
    keysOf("stats:buf:visit:2026-10-25");
    redisMock.hgetall.mockResolvedValue({ pv: "3", uv: "2" });
    executeRaw.mockRejectedValueOnce(new Error("db down"));
    await flushStatsBuffer();
    expect(redisMock.pipe.hincrby).toHaveBeenCalledWith("stats:buf:visit:2026-10-25", "pv", 3);
    expect(redisMock.pipe.hincrby).toHaveBeenCalledWith("stats:buf:visit:2026-10-25", "uv", 2);
    // 暂存键仍要清掉,否则等 5 分钟 TTL 才消失
    expect(redisMock.del).toHaveBeenCalledWith(expect.stringMatching(/^stats:flushing:/));
  });
});

describe("applyBufferKey 六类分发", () => {
  it("visit:全零不落库(正数才 UPSERT)", async () => {
    keysOf("stats:buf:visit:2026-10-25");
    redisMock.hgetall.mockResolvedValue({ pv: "0", uv: "0" });
    await flushStatsBuffer();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("visit:正数落 pv/uv 参数", async () => {
    keysOf("stats:buf:visit:2026-10-25");
    redisMock.hgetall.mockResolvedValue({ pv: "3", uv: "2" });
    await flushStatsBuffer();
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [, day, pv, uv] = executeRaw.mock.calls[0]!;
    expect(day).toBe("2026-10-25");
    expect([pv, uv]).toEqual([3, 2]);
  });

  it("post:负计数/零剪除仍计返回行数(现状语义),正数同步累加 views_count", async () => {
    keysOf("stats:buf:post:2026-10-25");
    redisMock.hgetall.mockResolvedValue({ "12": "4", "13": "-2", "14": "" });
    const summary = await flushStatsBuffer();
    // 返回值 = 字段键数(13/14 被 upsertPostView 剪除但计入 keys)——钉住现状
    expect(summary.postRows).toBe(3);
    // 仅 id=12 真正 UPSERT:日行 + views_count 累加各一次 = $transaction 内 2 条
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("geo:非法面/空 botName/零计数剔除,llms_index 面放行", async () => {
    keysOf("stats:buf:geo:2026-10-25");
    redisMock.hgetall.mockResolvedValue({
      "web|GPTBot|12": "2", // web 非合法面 → 剔
      "llms_index|GPTBot|12": "3",
      "llms_full||5": "1", // 空 botName → 剔
      "post_md|ClaudeBot|": "1", // 空 postId 占位 → 放行
      "post_md|ClaudeBot|15": "0", // 零计数 → 剔
    });
    await flushStatsBuffer();
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it("page:pv / uv 分键各写自己那一列(键形由 keys.ts 解析)", async () => {
    keysOf("stats:buf:page:2026-10-25:pv", "stats:buf:page:2026-10-25:uv");
    redisMock.hgetall.mockImplementation(async (key: string) =>
      key.endsWith(":pv") ? { "/post/1": "5" } : { "/post/1": "2" },
    );
    await flushStatsBuffer();
    const rows = executeRaw.mock.calls.map((c) => c.slice(1, 5)); // 末位是 DO UPDATE 的 Prisma.sql 片段
    expect(rows).toContainEqual(["2026-10-25", "/post/1", 5, 0]);
    expect(rows).toContainEqual(["2026-10-25", "/post/1", 0, 2]);
  });

  it("page 缺 metric(畸形键)→ 不猜成 uv,零落库", async () => {
    keysOf("stats:buf:page:2026-10-25");
    redisMock.hgetall.mockResolvedValue({ "/post/1": "5" });
    const summary = await flushStatsBuffer();
    expect(summary).toEqual({ keysFlushed: 1, postRows: 0 });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("未知 kind → 零处理", async () => {
    keysOf("stats:buf:mystery:2026-10-25");
    redisMock.hgetall.mockResolvedValue({ x: "1" });
    const summary = await flushStatsBuffer();
    expect(summary).toEqual({ keysFlushed: 1, postRows: 0 });
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
