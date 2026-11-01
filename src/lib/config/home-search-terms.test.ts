/**
 * 首页搜索建议词装配单测(M70):固定词打头 + 洞察关键词云补齐、7 天→30 天
 * 窗口兜底、全空回退内置词。只 mock prisma,词云/解析走真实现。
 * 注:词长下限 2(与洞察关键词云口径一致),单字词会被过滤。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { insightCluster: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import {
  DEFAULT_HOME_SEARCH_CHIPS,
  listHomeSearchTermCandidates,
  pickHomeSearchTerms,
  resolveHomeSearchTerms,
} from "./home-search-terms";

/** 洞察簇行(insightKeywordCloud 只读 id/label/keywords/score/sentiment) */
function cluster(keywords: string[], score = 90) {
  return { id: BigInt(7), label: "簇", keywords, score, sentiment: null };
}

beforeEach(() => {
  findMany.mockReset();
});

describe("pickHomeSearchTerms(纯选词)", () => {
  it("固定词打头,自动词补齐到 count", () => {
    expect(pickHomeSearchTerms(["甲组", "乙组"], ["丙组", "丁组"], 4)).toEqual([
      "甲组",
      "乙组",
      "丙组",
      "丁组",
    ]);
  });

  it("去重(大小写不敏感)且跳过非法词(单字/超长)", () => {
    expect(pickHomeSearchTerms(["MCP"], ["mcp", "x", "a".repeat(25), "乙组"], 3)).toEqual([
      "MCP",
      "乙组",
    ]);
    expect(pickHomeSearchTerms([" x "], [], 3)).toEqual([]);
  });

  it("总数不超过 count", () => {
    expect(pickHomeSearchTerms([], ["甲组", "乙组", "丙组", "丁组"], 3)).toEqual([
      "甲组",
      "乙组",
      "丙组",
    ]);
  });
});

describe("resolveHomeSearchTerms", () => {
  it("固定词已够数 → 不查词云,按勾选序出 chips", async () => {
    const chips = await resolveHomeSearchTerms({ words: ["甲组", "乙组", "丙组"], count: 3 });
    expect(findMany).not.toHaveBeenCalled();
    expect(chips).toEqual([
      { icon: "i-fire", label: "甲组", q: "甲组" },
      { icon: "i-book", label: "乙组", q: "乙组" },
      { icon: "i-tool", label: "丙组", q: "丙组" },
    ]);
  });

  it("固定词不足 → 用近 7 天热词补齐", async () => {
    findMany.mockResolvedValue([cluster(["丁组", "戊组", "己组", "庚组"], 95)]);
    const chips = await resolveHomeSearchTerms({ words: ["甲组"], count: 3 });
    expect(chips.map((c) => c.label)).toEqual(["甲组", "丁组", "戊组"]);
    // 7 天窗口不足 20 个 → 再查 30 天窗口合并
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("全自动:取前 count 个,图标轮换", async () => {
    findMany.mockResolvedValue([cluster(["甲组", "乙组", "丙组", "丁组"], 95)]);
    const chips = await resolveHomeSearchTerms({ words: [], count: 4 });
    expect(chips.map((c) => c.q)).toEqual(["甲组", "乙组", "丙组", "丁组"]);
    expect(chips.map((c) => c.icon)).toEqual(["i-fire", "i-book", "i-tool", "i-thunderbolt"]);
  });

  it("近 7 天无词 → 回落 30 天窗口", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cluster(["旧甲", "旧乙", "旧丙"], 60)]);
    const chips = await resolveHomeSearchTerms({ words: [], count: 3 });
    expect(chips.map((c) => c.label)).toEqual(["旧甲", "旧乙", "旧丙"]);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("两窗口皆空 → 内置兜底词", async () => {
    findMany.mockResolvedValue([]);
    await expect(resolveHomeSearchTerms({ words: [], count: 3 })).resolves.toEqual(
      DEFAULT_HOME_SEARCH_CHIPS,
    );
  });
});

describe("listHomeSearchTermCandidates", () => {
  it("7 天候选足够(≥20)时不再查 30 天窗口", async () => {
    const words = Array.from({ length: 20 }, (_, i) => `词${String(i).padStart(2, "0")}`);
    findMany.mockResolvedValueOnce([cluster(words, 90)]);
    const out = await listHomeSearchTermCandidates();
    expect(out).toHaveLength(20);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("合并两窗口并按出现序去重、截 20", async () => {
    findMany
      .mockResolvedValueOnce([cluster(["甲组", "乙组"], 90)])
      .mockResolvedValueOnce([cluster(["乙组", "丙组", "丁组"], 50)]);
    await expect(listHomeSearchTermCandidates()).resolves.toEqual(["甲组", "乙组", "丙组", "丁组"]);
  });
});
