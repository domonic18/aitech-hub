/**
 * 榜单解析单测(M58 批③,纯函数无库):四类取数形态的样本按真机结构构造——
 * - AA:Next.js flight 载荷跨片拼接(半片截断 JSON 亦能还原)、字符串内引号
 *   不干扰方括号配平、deprecated/无分模型剔除、重复 slug 去重;
 * - HF:公开 JSON 数组乱序重排、缺 trendingScore 剔除、命名空间作厂商;
 * - arXiv:Atom 逐条取 abs id 作键、export→访问域归一、缺标题剔除;
 * - GitHub Trending:Box-row 卡片取 owner/repo、中文/实体/带逗号 star 数;
 * - 空/畸形原文一律返回空数组(解析 0 条由编排层计源失败,不在此抛错)。
 */
import { describe, expect, it } from "vitest";

import {
  normalizeLeaderboardItems,
  parseArxivFeed,
  parseArtificialAnalysis,
  parseGithubTrending,
  parseHuggingFace,
  type LeaderboardItem,
} from "./parse";

/** 构造一帧 Next.js flight 载荷(字符串字面量即真实页面里的形态) */
function flight(chunk: string): string {
  return `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`;
}

describe("parseArtificialAnalysis", () => {
  const models = JSON.stringify([
    {
      slug: "kimi-k2",
      name: "Kimi K2",
      modelCreatorName: "Moonshot AI",
      intelligenceIndex: 42.5,
    },
    {
      slug: "legacy-1",
      name: "Legacy One",
      modelCreatorName: "Old Co",
      intelligenceIndex: 99,
      deprecated: true,
    },
    // 名称里的引号经两层转义:验证配平器对字符串内的 " 与 \\ 不误判
    { slug: "gpt-5", name: 'GPT "5"', modelCreatorName: "OpenAI", intelligenceIndex: 68 },
    { slug: "no-score", name: "No Score", intelligenceIndex: null },
    { slug: "kimi-k2", name: "Kimi K2 (重复)", intelligenceIndex: 42.5 },
  ]);

  it("跨片拼接 + 倒序 + 剔除下线/无分 + 同键去重", () => {
    const half = Math.floor(models.length / 2);
    const html =
      '<html><body><div id="__next">' +
      flight(`7:["$","$L1c",null,{"initialModels":${models.slice(0, half)}`) +
      flight(`${models.slice(half)},"other":1}]`) +
      "</div></body></html>";
    const items = parseArtificialAnalysis(html);
    expect(items.map((i) => i.entityKey)).toEqual(["gpt-5", "kimi-k2"]);
    expect(items[0]).toMatchObject({
      entityName: 'GPT "5"',
      entityType: "model",
      vendor: "OpenAI",
      score: 68,
      scoreUnit: "AAII",
      url: "https://artificialanalysis.ai/models/gpt-5",
    });
    expect(items[1].vendor).toBe("Moonshot AI");
  });

  it("无载荷/载荷损坏 → 空数组(契约漂移不静默出假数据)", () => {
    expect(parseArtificialAnalysis("<html><body>普通页面</body></html>")).toEqual([]);
    expect(parseArtificialAnalysis(flight("7:{"))).toEqual([]);
    expect(parseArtificialAnalysis(flight('7:{"initialModels":{}}'))).toEqual([]);
  });
});

describe("parseHuggingFace", () => {
  it("按 trendingScore 倒序、命名空间作厂商、缺分条目剔除", () => {
    const json = JSON.stringify([
      { id: "meta-llama/Llama-4", trendingScore: 320.5, downloads: 1000 },
      { id: "Qwen/Qwen3", trendingScore: 880 },
      { trendingScore: 10 },
      { id: "no-score-model" },
      { id: "org/model", trendingScore: 1 },
    ]);
    const items = parseHuggingFace(json);
    expect(items.map((i) => i.entityKey)).toEqual([
      "Qwen/Qwen3",
      "meta-llama/Llama-4",
      "org/model",
    ]);
    expect(items[0]).toMatchObject({
      entityName: "Qwen/Qwen3",
      vendor: "Qwen",
      score: 880,
      scoreUnit: "trending",
      url: "https://huggingface.co/Qwen/Qwen3",
    });
  });

  it("畸形 JSON/非数组 → 空数组", () => {
    expect(parseHuggingFace("not json")).toEqual([]);
    expect(parseHuggingFace('{"id":"x"}')).toEqual([]);
  });
});

describe("parseArxivFeed", () => {
  const base = "https://export.arxiv.org/api/query?search_query=cat:cs.AI";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2501.00001v1</id>
    <title>Attention Is All You Need 2</title>
  </entry>
  <entry>
    <id>http://export.arxiv.org/abs/2501.00002v2</id>
    <title>Scaling Laws for
      <em>Everything</em></title>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2501.00003v1</id>
    <title> </title>
  </entry>
</feed>`;

  it("取 abs id 末段为实体键、标题清洗、export 域归到 arxiv.org", () => {
    const items = parseArxivFeed(xml, base);
    expect(items.map((i) => i.entityKey)).toEqual(["2501.00001v1", "2501.00002v2"]);
    expect(items[0]).toMatchObject({
      entityName: "Attention Is All You Need 2",
      entityType: "paper",
      vendor: null,
      score: null,
      scoreUnit: null,
      url: "https://arxiv.org/abs/2501.00001v1",
    });
    expect(items[1].entityName).toBe("Scaling Laws for Everything");
  });
});

describe("parseGithubTrending", () => {
  const base = "https://github.com/trending?since=daily";
  const html = `<html><body>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/langchain-ai/langgraph" data-view-component="true" class="Link">
      <svg class="octicon"></svg>
      <span class="text-normal">langchain-ai /</span>
      langgraph
    </a>
  </h2>
  <p class="col-9 color-fg-muted">Build resilient LLM apps &amp; agents</p>
  <div class="f6 color-fg-muted mt-2">
    <span class="d-inline-block mr-3"><span itemprop="programmingLanguage">Python</span></span>
    <span class="d-inline-block float-sm-right"><svg class="octicon"></svg> 782 stars today</span>
  </div>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed">
    <a href="/acme/tiny-tool/" class="Link">acme / tiny-tool</a>
  </h2>
  <div class="f6">
    <span class="float-sm-right"> 1,204 stars today </span>
  </div>
</article>
</body></html>`;

  it("取 owner/repo 作键、star 数作热度、斜杠折叠", () => {
    const items = parseGithubTrending(html, base);
    expect(items.map((i) => i.entityKey)).toEqual(["langchain-ai/langgraph", "acme/tiny-tool"]);
    expect(items[0]).toMatchObject({
      entityName: "langchain-ai/langgraph",
      entityType: "repo",
      vendor: "langchain-ai",
      score: 782,
      scoreUnit: "stars/日",
      url: "https://github.com/langchain-ai/langgraph",
    });
    expect(items[1]).toMatchObject({ score: 1204, vendor: "acme" });
  });

  it("无卡片/无 h2 链接 → 空数组", () => {
    expect(parseGithubTrending("<html><body>rate limited</body></html>", base)).toEqual([]);
    expect(parseGithubTrending('<article class="Box-row"><p>no link</p></article>', base)).toEqual(
      [],
    );
  });
});

describe("normalizeLeaderboardItems", () => {
  it("空键/空链接丢弃,同键保留首条", () => {
    const mk = (entityKey: string, url: string): LeaderboardItem => ({
      entityKey,
      entityName: entityKey,
      entityType: "model",
      vendor: null,
      score: null,
      scoreUnit: null,
      url,
    });
    const out = normalizeLeaderboardItems([
      mk("a", "https://x/a"),
      mk("", "https://x/empty"),
      mk("b", ""),
      mk("a", "https://x/a-dup"),
    ]);
    expect(out.map((i) => i.url)).toEqual(["https://x/a"]);
  });
});
