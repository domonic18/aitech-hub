/**
 * checkpointer 单测:池/实例单例、setup 幂等守卫(并发共享同 Promise)、
 * 失败清守卫可重试、池上限钉 3(生产 PG max_connections=20 保护)。
 * pg/PostgresSaver 经 vi.mock 替身,不触达真 DB。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const poolCtor = vi.hoisted(() => vi.fn());
const saverCtor = vi.hoisted(() => vi.fn());
const setupMock = vi.hoisted(() => vi.fn());

vi.mock("pg", () => ({ default: { Pool: poolCtor } }));
vi.mock("@langchain/langgraph-checkpoint-postgres", () => ({
  PostgresSaver: saverCtor,
}));
vi.mock("../env", () => ({ env: { DATABASE_URL: "postgresql://u:p@localhost:5434/t" } }));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ensureAgentCheckpointer, getAgentCheckpointer, getAgentPgPool } from "./checkpointer";

beforeEach(() => {
  // 清 globalThis 单例状态(模块级缓存跨用例泄漏)
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.agentPgPool;
  delete g.agentCheckpointer;
  delete g.agentSetupPromise;
  poolCtor.mockReset();
  saverCtor.mockReset();
  setupMock.mockReset();
});

describe("agent checkpointer", () => {
  it("pg Pool 单例:复用连接串,池上限 3", () => {
    // 可构造(传统 function):new pg.Pool(...) 需要
    poolCtor.mockImplementation(function () {
      return { on: vi.fn() };
    });
    const a = getAgentPgPool();
    const b = getAgentPgPool();
    expect(a).toBe(b);
    expect(poolCtor).toHaveBeenCalledTimes(1);
    expect(poolCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: "postgresql://u:p@localhost:5434/t",
        max: 3,
      }),
    );
  });

  it("PostgresSaver 单例且挂同一池", () => {
    poolCtor.mockImplementation(function () {
      return { on: vi.fn() };
    });
    saverCtor.mockImplementation(function (this: unknown, pool: unknown) {
      return { pool };
    });
    const a = getAgentCheckpointer();
    const b = getAgentCheckpointer();
    expect(a).toBe(b);
    expect(saverCtor).toHaveBeenCalledWith(getAgentPgPool());
  });

  it("setup 并发共享同一 Promise,只调一次", async () => {
    poolCtor.mockImplementation(function () {
      return { on: vi.fn() };
    });
    saverCtor.mockImplementation(function () {
      return { setup: setupMock };
    });
    setupMock.mockResolvedValue(undefined);
    await Promise.all([ensureAgentCheckpointer(), ensureAgentCheckpointer()]);
    expect(setupMock).toHaveBeenCalledTimes(1);
  });

  it("setup 失败清守卫,重试重建", async () => {
    poolCtor.mockImplementation(function () {
      return { on: vi.fn() };
    });
    saverCtor.mockImplementation(function () {
      return { setup: setupMock };
    });
    setupMock.mockRejectedValueOnce(new Error("db down"));
    await expect(ensureAgentCheckpointer()).rejects.toThrow("db down");
    setupMock.mockResolvedValue(undefined);
    await expect(ensureAgentCheckpointer()).resolves.toBeUndefined();
    expect(setupMock).toHaveBeenCalledTimes(2);
  });
});
