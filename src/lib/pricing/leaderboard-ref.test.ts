/**
 * 牌价页榜单引用单测(P5):模型键 → insight 实体 → 最新榜单名次。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const snapshotFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    insightLeaderboardSnapshot: {
      findMany: (...a: unknown[]) => snapshotFindMany(...a),
    },
  },
}));

const resolveLeaderboardEntities = vi.fn();
vi.mock("@/lib/insight/entities/leaderboard", () => ({
  resolveLeaderboardEntities: (...a: unknown[]) => resolveLeaderboardEntities(...a),
}));

import { loadPricingLeaderboardPresence, type LeaderboardBadge } from "./leaderboard-ref";

function badge(
  over: Partial<LeaderboardBadge> & { source: string; rank: number },
): LeaderboardBadge {
  return {
    board: "lm Arena",
    delta: null,
    score: null,
    scoreUnit: null,
    capturedDate: "2026-11-25",
    url: null,
    ...over,
  };
}

describe("loadPricingLeaderboardPresence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未命中实体 → 空 map", async () => {
    resolveLeaderboardEntities.mockResolvedValue(new Map());
    snapshotFindMany.mockResolvedValue([]);
    const map = await loadPricingLeaderboardPresence([
      { modelKey: "unknown-model", modelDictKey: null, modelGroupKey: null },
    ]);
    expect(map.size).toBe(0);
  });

  it("命中实体后返回最新榜单名次与 delta", async () => {
    resolveLeaderboardEntities.mockImplementation(
      async (_source: string, keys: readonly string[]) => {
        const out = new Map<string, { id: bigint; key: string } | null>();
        for (const k of keys) out.set(k, k === "qwen3" ? { id: BigInt(10), key: "qwen3" } : null);
        return out;
      },
    );
    snapshotFindMany.mockResolvedValue([
      {
        source: "artificial-analysis",
        board: "lm-arena",
        rank: 3,
        score: 1200,
        scoreUnit: "elo",
        capturedDate: new Date("2026-11-25"),
        meta: { url: "https://example.com/3" },
        entityId: BigInt(10),
      },
      {
        source: "artificial-analysis",
        board: "lm-arena",
        rank: 5,
        score: 1180,
        scoreUnit: "elo",
        capturedDate: new Date("2026-11-24"),
        meta: null,
        entityId: BigInt(10),
      },
    ]);

    const map = await loadPricingLeaderboardPresence([
      { modelKey: "qwen3-8b", modelDictKey: "qwen3", modelGroupKey: null },
    ]);
    expect(map.get("qwen3")).toEqual([
      badge({
        source: "artificial-analysis",
        board: "lm-arena",
        rank: 3,
        score: 1200,
        scoreUnit: "elo",
        delta: 2,
        url: "https://example.com/3",
      }),
    ]);
  });

  it("HF 末段回退:qwen/qwen3-8b 通过 last segment 命中", async () => {
    resolveLeaderboardEntities.mockImplementation(
      async (_source: string, keys: readonly string[]) => {
        const out = new Map<string, { id: bigint; key: string } | null>();
        for (const k of keys) {
          if (k === "qwen3-8b" || k.toLowerCase().endsWith("/qwen3-8b")) {
            out.set(k, { id: BigInt(20), key: "qwen3-8b" });
          }
        }
        return out;
      },
    );
    snapshotFindMany.mockResolvedValue([
      {
        source: "huggingface",
        board: "hf-open-llm",
        rank: 10,
        score: null,
        scoreUnit: null,
        capturedDate: new Date("2026-11-25"),
        meta: { url: "https://huggingface.co/10" },
        entityId: BigInt(20),
      },
    ]);

    const map = await loadPricingLeaderboardPresence([
      { modelKey: "Qwen/Qwen3-8B", modelDictKey: null, modelGroupKey: null },
    ]);
    expect(map.get("Qwen/Qwen3-8B")?.[0]?.rank).toBe(10);
  });
});
