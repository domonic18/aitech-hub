/**
 * Agent 额度配置单测(2026-10-17 验收反馈:额度后台可调):读侧缺行/非法
 * 回默认与 clamp、deriveRecursionLimit 2.5× 派生与硬夹、toRunLimits 形状、
 * setAgentLimits 多键事务 upsert 与空请求跳过、Zod 越界拒绝。
 */
import { describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  siteConfig: {
    findMany: vi.fn<(args?: unknown) => Promise<unknown[]>>(),
    upsert: vi.fn<(args: unknown) => Promise<unknown>>(),
  },
  $transaction: vi.fn<(arg: unknown) => Promise<unknown>>(),
}));
vi.mock("../db", () => ({ prisma: prismaMock }));

import {
  AGENT_LIMIT_KEYS,
  AgentLimitsUpdateSchema,
  DEFAULT_AGENT_LIMITS,
  deriveRecursionLimit,
  getAgentLimitsAll,
  setAgentLimits,
  toRunLimits,
} from "./agent-limits";

describe("getAgentLimitsAll", () => {
  it("缺行 → 三档全默认", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValueOnce([]);
    expect(await getAgentLimitsAll()).toEqual(DEFAULT_AGENT_LIMITS);
  });

  it("合法行覆盖默认;非法/越界 clamp 回默认域", async () => {
    prismaMock.siteConfig.findMany.mockResolvedValueOnce([
      { key: AGENT_LIMIT_KEYS.admin.toolCalls, value: "120" },
      { key: AGENT_LIMIT_KEYS.admin.tokens, value: "800000" },
      { key: AGENT_LIMIT_KEYS.guest.toolCalls, value: "0" }, // 低于下限 → 默认
      { key: AGENT_LIMIT_KEYS.guest.tokens, value: "abc" }, // 非数 → 默认
      { key: AGENT_LIMIT_KEYS.user.toolCalls, value: "999" }, // 超上限 → clamp 200
      { key: AGENT_LIMIT_KEYS.user.tokens, value: "999999999" }, // 超上限 → clamp 200 万
    ]);
    const all = await getAgentLimitsAll();
    expect(all.admin).toEqual({ toolCalls: 120, tokens: 800_000 });
    expect(all.guest).toEqual(DEFAULT_AGENT_LIMITS.guest);
    expect(all.user).toEqual({ toolCalls: 200, tokens: 2_000_000 });
  });
});

describe("deriveRecursionLimit(2.5× 派生,硬夹 16..500)", () => {
  it("与历史默认一致:12→30、80→200", () => {
    expect(deriveRecursionLimit(12)).toBe(30);
    expect(deriveRecursionLimit(80)).toBe(200);
  });

  it("极小/极大档硬夹", () => {
    expect(deriveRecursionLimit(1)).toBe(16);
    expect(deriveRecursionLimit(1000)).toBe(500);
  });
});

describe("toRunLimits", () => {
  it("额度展开 + recursion 派生", () => {
    expect(toRunLimits({ toolCalls: 80, tokens: 400_000 })).toEqual({
      toolCalls: 80,
      tokens: 400_000,
      recursion: 200,
    });
  });
});

describe("setAgentLimits", () => {
  it("partial 键事务 upsert(数值字符串化入 kv)", async () => {
    await setAgentLimits({ adminToolCalls: 100, guestTokens: 60_000 });
    expect(prismaMock.siteConfig.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.siteConfig.upsert).toHaveBeenNthCalledWith(1, {
      where: { key: AGENT_LIMIT_KEYS.guest.tokens },
      update: { value: "60000" },
      create: { key: AGENT_LIMIT_KEYS.guest.tokens, value: "60000" },
    });
    expect(prismaMock.siteConfig.upsert).toHaveBeenNthCalledWith(2, {
      where: { key: AGENT_LIMIT_KEYS.admin.toolCalls },
      update: { value: "100" },
      create: { key: AGENT_LIMIT_KEYS.admin.toolCalls, value: "100" },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("全空输入不发事务", async () => {
    await setAgentLimits({});
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("AgentLimitsUpdateSchema", () => {
  it("越界拒绝", () => {
    expect(AgentLimitsUpdateSchema.safeParse({ adminToolCalls: 0 }).success).toBe(false);
    expect(AgentLimitsUpdateSchema.safeParse({ adminToolCalls: 201 }).success).toBe(false);
    expect(AgentLimitsUpdateSchema.safeParse({ guestTokens: 500 }).success).toBe(false);
    expect(AgentLimitsUpdateSchema.safeParse({ guestTokens: 2_000_001 }).success).toBe(false);
    expect(AgentLimitsUpdateSchema.safeParse({ userToolCalls: 1.5 }).success).toBe(false);
  });

  it("合法 partial 放行", () => {
    expect(AgentLimitsUpdateSchema.safeParse({ adminToolCalls: 120 }).success).toBe(true);
  });
});
