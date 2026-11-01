/**
 * /leaderboards/ 读侧纯函数单测(M58 批③,prisma mock 无真库):名次差口径
 * (上期名次 - 本期名次;上期无此条 → null 即「NEW」,非 0)与 JSON-LD 清单
 * 构造(空榜不出结构化数据、缺名回退键、缺分不带单位串)。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { buildLeaderboardJsonLd, rankDelta } from "./public";
import type { PublicLeaderboards } from "./public";

describe("rankDelta", () => {
  it("上升为正、下降为负、持平为 0、新入榜为 null(不与 0 混同)", () => {
    const delta = rankDelta(
      [
        { entityKey: "up", rank: 2 },
        { entityKey: "down", rank: 5 },
        { entityKey: "same", rank: 3 },
        { entityKey: "new", rank: 1 },
      ],
      [
        { entityKey: "up", rank: 6 },
        { entityKey: "down", rank: 2 },
        { entityKey: "same", rank: 3 },
      ],
    );
    expect(delta.get("up")).toBe(4);
    expect(delta.get("down")).toBe(-3);
    expect(delta.get("same")).toBe(0);
    expect(delta.get("new")).toBeNull();
  });

  it("上期为空(首期)全部 null", () => {
    const delta = rankDelta([{ entityKey: "a", rank: 1 }], []);
    expect(delta.get("a")).toBeNull();
  });
});

describe("buildLeaderboardJsonLd", () => {
  const data: PublicLeaderboards = {
    asOf: "2026-10-30",
    boards: [
      {
        key: "artificial-analysis",
        board: "智能指数",
        label: "Artificial Analysis",
        sourceUrl: "https://artificialanalysis.ai/leaderboards/models",
        entityType: "model",
        capturedDate: "2026-10-30",
        staleDays: 0,
        hasPrevious: true,
        rows: [
          {
            rank: 1,
            entityKey: "gpt-5",
            entityName: "GPT 5",
            entityType: "model",
            vendor: "OpenAI",
            score: 68,
            scoreUnit: "AAII",
            url: "https://artificialanalysis.ai/models/gpt-5",
            extra: {},
            delta: 2,
          },
          {
            rank: 2,
            entityKey: "2501.00001",
            entityName: "",
            entityType: "paper",
            vendor: null,
            score: null,
            scoreUnit: null,
            url: "",
            extra: {},
            delta: null,
          },
        ],
      },
    ],
  };

  it("拍平各榜为有序清单:缺名回退键、缺分不带单位、缺链回退页面地址", () => {
    const ld = buildLeaderboardJsonLd(data, "https://17aitech.com/leaderboards/");
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.numberOfItems).toBe(2);
    const items = ld.itemListElement as Array<{
      position: number;
      item: { name: string; description: string; url: string };
    }>;
    expect(items[0].position).toBe(1);
    expect(items[0].item.name).toBe("GPT 5");
    expect(items[0].item.description).toContain("智能指数 第 1 名,68 AAII");
    expect(items[1].item.name).toBe("2501.00001");
    expect(items[1].item.description).not.toContain("null");
    expect(items[1].item.url).toBe("https://17aitech.com/leaderboards/");
  });

  it("空榜:numberOfItems 0 且清单为空(页面据此不出 JSON-LD)", () => {
    const ld = buildLeaderboardJsonLd(
      { boards: [], asOf: null },
      "https://17aitech.com/leaderboards/",
    );
    expect(ld.numberOfItems).toBe(0);
    expect(ld.itemListElement).toEqual([]);
  });
});
