import { describe, expect, it } from "vitest";

import {
  fuseCompare,
  hitPercent,
  postScoreFields,
  rankAndCut,
  repoScoreFields,
  rrfScore,
  scoreTerms,
  telegramScoreFields,
  toPostHit,
  toRepoHit,
  toTelegramHit,
  type FusedCandidate,
} from "./search-view";

describe("scoreTerms", () => {
  const terms = ["mcp", "实战"];

  it("title 3 > summary 2 > body 1 加权", () => {
    expect(scoreTerms(terms, { title: "MCP 实战指南" })).toEqual({ score: 6, coverage: 1 });
    expect(scoreTerms(terms, { title: "", summary: "mcp 与实战" })).toEqual({
      score: 4,
      coverage: 1,
    });
    expect(scoreTerms(terms, { title: "", body: "mcp 实战" })).toEqual({ score: 2, coverage: 1 });
  });

  it("部分命中按比例计 coverage", () => {
    expect(scoreTerms(terms, { title: "mcp 指南" })).toEqual({ score: 3, coverage: 0.5 });
  });

  it("空词项 coverage 0(防除零)", () => {
    expect(scoreTerms([], { title: "x" })).toEqual({ score: 0, coverage: 0 });
  });
});

describe("hitPercent", () => {
  it("覆盖率映射百分比,下限 1(SQL OR 保证至少命中一处)", () => {
    expect(hitPercent(1)).toBe(100);
    expect(hitPercent(0.5)).toBe(50);
    expect(hitPercent(0)).toBe(1);
    expect(hitPercent(0.001)).toBe(1);
  });
});

describe("rankAndCut", () => {
  const rows = [
    {
      key: "old-high",
      id: "1",
      dateIso: "2026-01-01T00:00:00Z",
      title: "mcp",
      summary: "mcp",
      body: "mcp",
    },
    {
      key: "new-low",
      id: "2",
      dateIso: "2026-06-01T00:00:00Z",
      title: "mcp",
      summary: "",
      body: "",
    },
    {
      key: "new-mid",
      id: "3",
      dateIso: "2026-06-02T00:00:00Z",
      title: "实战 mcp",
      summary: "",
      body: "",
    },
  ];

  it("score desc → date desc → id desc 截断", () => {
    const ranked = rankAndCut(rows, ["mcp"], 3, (r) => r);
    expect(ranked.map((r) => r.key)).toEqual(["old-high", "new-mid", "new-low"]);
    expect(ranked[0]!.hitPct).toBe(100);
  });

  it("limit 截断", () => {
    expect(rankAndCut(rows, ["mcp"], 2, (r) => r)).toHaveLength(2);
  });

  it("同分同日期按 id 数值 desc(非字典序)", () => {
    const tied = [
      { key: "a", id: "9", dateIso: null, title: "x", summary: "", body: "" },
      { key: "b", id: "10", dateIso: null, title: "x", summary: "", body: "" },
    ];
    expect(rankAndCut(tied, ["x"], 2, (r) => r).map((r) => r.key)).toEqual(["b", "a"]);
  });
});

describe("rrfScore / fuseCompare(M20 双榜融合)", () => {
  const c = (p: Partial<FusedCandidate>): FusedCandidate => ({
    id: "x",
    kwRank: null,
    vecRank: null,
    kwScore: 0,
    date: 0,
    ...p,
  });

  it("RRF:双榜命中 > 任一单榜;榜内越靠前分越高;k=60 排名公式", () => {
    expect(rrfScore(c({ kwRank: 0, vecRank: 2 }))).toBeGreaterThan(rrfScore(c({ kwRank: 0 })));
    expect(rrfScore(c({ kwRank: 0 }))).toBeCloseTo(1 / 61, 9);
    expect(rrfScore(c({ vecRank: 0 }))).toBeCloseTo(1 / 61, 9);
    expect(rrfScore(c({ kwRank: 1 }))).toBeCloseTo(1 / 62, 9);
    expect(rrfScore(c({ kwRank: 0, vecRank: 1 }))).toBeCloseTo(1 / 61 + 1 / 62, 9);
  });

  it("降级形态(仅词项榜):RRF 严格随排名递减,排序不变(行为不回归)", () => {
    const rows = [0, 1, 2].map((kwRank) => c({ id: String(2 - kwRank), kwRank }));
    expect([...rows].sort(fuseCompare).map((r) => r.id)).toEqual(["2", "1", "0"]);
  });

  it("RRF 同分 tiebreak:词法证据(kwScore)优先 → date → id 数值", () => {
    // 词项榜 rank 0 单榜 vs 向量榜 rank 0 纯语义:同分,字面命中在前
    const kw = c({ id: "1", kwRank: 0, kwScore: 3 });
    const vec = c({ id: "2", vecRank: 0 });
    expect(fuseCompare(kw, vec)).toBeLessThan(0);
    // 同分同 kwScore:date 新者在前
    const older = c({ id: "1", vecRank: 3, date: 100 });
    const newer = c({ id: "2", vecRank: 3, date: 200 });
    expect(fuseCompare(newer, older)).toBeLessThan(0);
    // 全同:id 数值 desc(非字典序,9 vs 10)
    const id9 = c({ id: "9", vecRank: 3 });
    const id10 = c({ id: "10", vecRank: 3 });
    expect(fuseCompare(id10, id9)).toBeLessThan(0);
  });
});

describe("三域行 → 命中视图映射", () => {
  it("toTelegramHit:BigInt 转 string、aiSummary 展示优先、video 投影", () => {
    const row = {
      id: BigInt(42),
      title: "MCP 发布",
      summary: "原始摘要",
      url: "https://example.com/a",
      publishedAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-06-01T01:00:00Z"),
      mediaType: "video",
      videoPlatform: "douyin",
      videoBlogger: "老李",
      videoCoverUrl: "https://cdn/c.jpg",
      videoDuration: 192,
      videoEngagement: { play: 21000, like: -1, comment: "x" },
      aiTopic: "MCP",
      aiSummary: "AI 解读文本",
      aiKeywords: ["mcp", 1],
      source: { name: "机器之心", type: "rss" },
      hitPct: 88,
    };
    const hit = toTelegramHit(row);
    expect(hit.id).toBe("42");
    expect(hit.mediaType).toBe("video");
    expect(hit.snippet).toBe("AI 解读文本");
    expect(hit.aiSummary).toBe("AI 解读文本");
    expect(hit.video).toEqual({
      platform: "douyin",
      blogger: "老李",
      coverUrl: "https://cdn/c.jpg",
      durationSeconds: 192,
      engagement: { play: 21000, like: null, comment: null },
    });
  });

  it("toPostHit:postPath 站内链 + tags 平铺 + views 数值化", () => {
    const hit = toPostHit({
      id: BigInt(156),
      slug: "mcp-guide",
      title: "MCP 实战",
      excerpt: "从零开始",
      viewsCount: BigInt(1200),
      publishedAt: new Date("2026-05-01T00:00:00Z"),
      tags: [{ tag: { name: "MCP" } }, { tag: { name: "发布" } }],
      hitPct: 75,
    });
    expect(hit.href).toBe("/post/156-mcp-guide/");
    expect(hit.viewsCount).toBe(1200);
    expect(hit.tags).toEqual(["MCP", "发布"]);
  });

  it("toRepoHit:外链 htmlUrl + postCount", () => {
    const hit = toRepoHit({
      id: 7,
      fullName: "domonic18/mcp-kit",
      description: "工具箱",
      stars: 3400,
      language: "TypeScript",
      topics: ["mcp"],
      htmlUrl: "https://github.com/domonic18/mcp-kit",
      updatedAt: new Date("2026-06-01T00:00:00Z"),
      _count: { posts: 4 },
      hitPct: 60,
    });
    expect(hit.href).toBe("https://github.com/domonic18/mcp-kit");
    expect(hit.postCount).toBe(4);
    expect(hit.stars).toBe(3400);
  });

  it("计分字段桶:telegram topic/keywords 并入摘要,repo topics 并入摘要", () => {
    expect(
      telegramScoreFields({
        id: BigInt(1),
        title: null,
        summary: "s",
        url: "",
        publishedAt: null,
        createdAt: new Date(),
        mediaType: "text",
        videoPlatform: null,
        videoBlogger: null,
        videoCoverUrl: null,
        videoDuration: null,
        videoEngagement: null,
        aiTopic: "主题",
        aiSummary: "解读",
        aiKeywords: ["k1", "k2"],
        source: { name: "n", type: "rss" },
      }).summary,
    ).toContain("k1");
    expect(
      repoScoreFields({
        id: 1,
        fullName: "repo",
        description: null,
        stars: 0,
        language: null,
        topics: [],
        htmlUrl: "",
        updatedAt: new Date(),
        _count: { posts: 0 },
      }).summary,
    ).toBe("");
    expect(
      postScoreFields({
        id: BigInt(2),
        slug: null,
        title: "t",
        excerpt: null,
        viewsCount: BigInt(0),
        publishedAt: null,
        tags: [],
      }),
    ).toEqual({ title: "t", summary: "" });
  });
});
