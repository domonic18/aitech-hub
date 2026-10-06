/**
 * quota 单测(Redis 必 mock):20 会话/日独立计数、超限 false、Redis 挂放行、
 * run 频控 10 次/分/IP、无 IP 放行——护栏非计费口径。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const incrMock = vi.hoisted(() => vi.fn());
const expireMock = vi.hoisted(() => vi.fn());

vi.mock("../redis", () => ({
  redis: { incr: incrMock, expire: expireMock },
}));

import {
  AGENT_RUN_RL_LIMIT,
  AGENT_SESSION_DAILY_MAX,
  tryConsumeAgentRunQuota,
  tryConsumeSessionQuota,
} from "./quota";

beforeEach(() => {
  incrMock.mockReset();
  expireMock.mockReset();
  incrMock.mockResolvedValue(1);
  expireMock.mockResolvedValue(1);
});

describe("tryConsumeSessionQuota", () => {
  it("第 1 次 INCR=1 ≤ 20 放行,且补 TTL", async () => {
    await expect(tryConsumeSessionQuota("v-1")).resolves.toBe(true);
    expect(expireMock).toHaveBeenCalledTimes(1);
  });

  it("INCR 超过 20 → false(超限入口置灰的数据面)", async () => {
    incrMock.mockResolvedValue(AGENT_SESSION_DAILY_MAX + 1);
    await expect(tryConsumeSessionQuota("v-1")).resolves.toBe(false);
  });

  it("Redis 挂 → 放行(护栏非计费,同 answer rate-limit 口径)", async () => {
    incrMock.mockRejectedValue(new Error("redis down"));
    await expect(tryConsumeSessionQuota("v-1")).resolves.toBe(true);
    expect(expireMock).not.toHaveBeenCalled();
  });
});

describe("tryConsumeAgentRunQuota", () => {
  it("空 IP(本机直连调试)放行", async () => {
    await expect(tryConsumeAgentRunQuota("")).resolves.toBe(true);
    expect(incrMock).not.toHaveBeenCalled();
  });

  it("INCR 超过 10 次/分 → false", async () => {
    incrMock.mockResolvedValue(AGENT_RUN_RL_LIMIT + 1);
    await expect(tryConsumeAgentRunQuota("1.2.3.4")).resolves.toBe(false);
  });
});
