/**
 * 榜单编排纯逻辑单测(M58 批③,prisma/logger mock 无真库):名次口径(有分值
 * 倒序、同分保持解析序、无分名次榜保序)与北京日锚(UTC 零点存 @db.Date)。
 * 取数/落库/幂等走真机链路验收,不在此仿真。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { leaderboardDay, rankItems } from "./crawl";
import type { LeaderboardItem } from "./parse";

function item(entityKey: string, score: number | null): LeaderboardItem {
  return {
    entityKey,
    entityName: entityKey,
    entityType: "model",
    vendor: null,
    score,
    scoreUnit: score === null ? null : "AAII",
    url: `https://example.com/${entityKey}`,
  };
}

describe("rankItems", () => {
  it("有分值:倒序;同分保持解析序(稳定)", () => {
    const out = rankItems([item("a", 10), item("b", 30), item("c", 10), item("d", 20)]);
    expect(out.map((i) => i.entityKey)).toEqual(["b", "d", "a", "c"]);
  });

  it("全部无分:保持原文顺序(名次榜:arXiv 最新 / GitHub 日榜)", () => {
    const out = rankItems([item("x", null), item("y", null), item("z", null)]);
    expect(out.map((i) => i.entityKey)).toEqual(["x", "y", "z"]);
  });

  it("混合有无分:无分沉底且互不重排", () => {
    const out = rankItems([item("n1", null), item("s1", 5), item("n2", null), item("s2", 9)]);
    expect(out.map((i) => i.entityKey)).toEqual(["s2", "s1", "n1", "n2"]);
  });
});

describe("leaderboardDay", () => {
  it("北京日界切日:北京 00:30 属当日(UTC 仍是前一日 16:30)", () => {
    // 2026-10-31 00:30 +08:00 = 2026-10-30T16:30:00Z
    const now = new Date("2026-10-30T16:30:00Z");
    expect(leaderboardDay(now).toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });

  it("北京 23:30 仍归当日(UTC 同日 15:30)", () => {
    const now = new Date("2026-10-30T15:30:00Z");
    expect(leaderboardDay(now).toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });
});
