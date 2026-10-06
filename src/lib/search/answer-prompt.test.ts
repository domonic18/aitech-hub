/**
 * 答案 prompt 组装单测(K2):三域拉链交错的引用选取与上限、编号资料块
 * (正文优先回落摘要、截 300)、系统 prompt 有/无资料两变体与哨兵约定。
 */
import { describe, expect, it } from "vitest";

import type { SearchHit, SearchGroup } from "./search-view";
import {
  CITE_LIMIT,
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  buildCiteBlocks,
  citeKindOf,
  pickCitations,
} from "./answer-prompt";

function hit(domain: SearchHit["domain"], i: number): SearchHit {
  const base = {
    id: String(i),
    title: `${domain}${i}`,
    snippet: "s",
    href: "h",
    dateIso: null,
    hitPct: 50,
  };
  if (domain === "telegram") {
    return {
      ...base,
      domain,
      sourceName: "n",
      sourceType: "rss",
      mediaType: "text",
      aiSummary: null,
    };
  }
  if (domain === "post") return { ...base, domain, viewsCount: 0, tags: [] };
  return { ...base, domain, fullName: "f", stars: 0, language: null, topics: [], postCount: 0 };
}

function group(domain: SearchGroup["domain"], n: number): SearchGroup {
  return {
    domain,
    label: domain,
    tagKey: domain.toUpperCase(),
    total: n,
    items: Array.from({ length: n }, (_, i) => hit(domain, i)),
    moreHref: "/",
    moreLabel: "more",
  };
}

describe("pickCitations", () => {
  it("三域拉链交错,裁 CITE_LIMIT(超量域不独占)", () => {
    const picks = pickCitations({
      telegram: group("telegram", 6),
      post: group("post", 4),
      repo: group("repo", 4),
    });
    expect(picks).toHaveLength(CITE_LIMIT);
    expect(picks.map((p) => p.domain)).toEqual([
      "telegram",
      "post",
      "repo",
      "telegram",
      "post",
      "repo",
      "telegram",
      "post",
    ]);
  });

  it("某域为空不阻塞拉链;全空出空", () => {
    const picks = pickCitations({
      telegram: group("telegram", 2),
      post: group("post", 0),
      repo: group("repo", 1),
    });
    expect(picks.map((p) => p.domain)).toEqual(["telegram", "repo", "telegram"]);
    expect(
      pickCitations({
        telegram: group("telegram", 0),
        post: group("post", 0),
        repo: group("repo", 0),
      }),
    ).toEqual([]);
  });
});

describe("citeKindOf / buildCiteBlocks", () => {
  it("kind 分派与正文优先回落摘要、编号对齐、截 300", () => {
    const tg = hit("telegram", 1);
    const post = hit("post", 2);
    const repo = hit("repo", 3);
    expect(citeKindOf(tg)).toBe("feed-text");
    expect(citeKindOf(post)).toBe("post");
    expect(citeKindOf(repo)).toBe("repo");

    const long = "长".repeat(400);
    const blocks = buildCiteBlocks([post, tg], new Map([["post:2", long]]));
    const [b1, b2] = blocks.split("\n\n");
    expect(b1).toContain("[1] (post) post2");
    expect(b1!.length).toBeLessThan(400);
    expect(b2).toContain("[2] (feed-text) telegram1");
    expect(b2).toContain("s"); // 回落 snippet
  });
});

describe("buildAnswerSystemPrompt", () => {
  it("有资料:仅依据资料 + [n] 标注 + 哨兵与 3 追问约定", () => {
    const p = buildAnswerSystemPrompt(false);
    expect(p).toContain("只依据");
    expect(p).toContain("[1]");
    expect(p).toContain("###FOLLOW###");
    expect(p).toContain("3 行追问");
  });

  it("无资料变体(0 命中红线):凭模型知识、不用 [n]、仍带哨兵", () => {
    const p = buildAnswerSystemPrompt(true);
    expect(p).toContain("站内没有检索到");
    expect(p).toContain("不使用 [n]");
    expect(p).toContain("禁止编造");
    expect(p).toContain("###FOLLOW###");
  });
});

describe("buildAnswerUserPrompt", () => {
  it("有资料:编号块 + 问题;无资料:仅问题", () => {
    expect(buildAnswerUserPrompt("q", "[1] (post) t\n链接: h\n正文")).toContain("编号资料:");
    expect(buildAnswerUserPrompt("q", "")).toBe("用户问题:q");
  });
});
