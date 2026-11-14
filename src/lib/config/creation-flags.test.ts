/**
 * 创作侧总闸单测(M72 瘦身 B0):`creation.agent_enabled` 的缺省与容错语义。
 *
 * 熔断闸的缺省方向是**开**(fail-open):缺行/非法值 → 站内创作可用。
 * 理由——缺行多见于「从未配置」,而误关的代价(站内创作全线不可用)远大于
 * 误开(多留一条待拆的创作面)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    siteConfig: { findUnique: (...a: unknown[]) => findUnique(...a) },
  },
}));

import { CREATION_FLAG_KEYS, isCreationAgentEnabled } from "./creation-flags";

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
});

describe("创作侧总闸 creation.agent_enabled", () => {
  it("缺行 → 开(fail-open)", async () => {
    findUnique.mockResolvedValue(null);
    expect(await isCreationAgentEnabled()).toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: CREATION_FLAG_KEYS.agentEnabled },
      select: { value: true },
    });
  });

  it("显式关值 → 关", async () => {
    for (const v of ["false", "FALSE", " false ", "0", "off", "no"]) {
      findUnique.mockResolvedValue({ value: v });
      expect(await isCreationAgentEnabled(), `值 ${v}`).toBe(false);
    }
  });

  it("显式开值 → 开", async () => {
    for (const v of ["true", "1", "on", "yes"]) {
      findUnique.mockResolvedValue({ value: v });
      expect(await isCreationAgentEnabled(), `值 ${v}`).toBe(true);
    }
  });

  it("非法值 → 开(不因手滑把创作全线关掉)", async () => {
    findUnique.mockResolvedValue({ value: "随便写的" });
    expect(await isCreationAgentEnabled()).toBe(true);
  });

  it("空串 → 开(缺省语义)", async () => {
    findUnique.mockResolvedValue({ value: "" });
    expect(await isCreationAgentEnabled()).toBe(true);
  });
});
