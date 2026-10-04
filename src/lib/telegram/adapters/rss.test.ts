import { afterEach, describe, expect, it, vi } from "vitest";

import { applyToken, fetchRssItems, parseFeed, RateLimitedError } from "./rss";

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>量子位</title>
<item><title><![CDATA[新模型发布]]></title>
<link>https://www.qbitai.com/2025/10/1.html?utm_source=x</link>
<pubDate>Fri, 03 Oct 2025 08:00:00 +0800</pubDate>
<description><![CDATA[<p>正文片段</p>]]></description></item>
<item><title>无链接条目</title><description>x</description></item>
</channel></rss>`;

const ATOM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom 条目</title>
<link rel="alternate" href="https://a.com/x"/>
<updated>2025-10-03T08:00:00Z</updated>
<summary>摘要文本</summary></entry>
<entry><title>多链接选 alternate</title>
<link rel="self" href="https://a.com/self"/>
<link rel="alternate" href="https://a.com/real"/></entry>
</feed>`;

describe("parseFeed", () => {
  it("RSS 2.0:CDATA/HTML 原样透传,pubDate 解析,无 link 条目丢弃", () => {
    const items = parseFeed(RSS_XML);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("新模型发布");
    expect(items[0]?.url).toBe("https://www.qbitai.com/2025/10/1.html?utm_source=x");
    expect(items[0]?.summaryCandidate).toBe("<p>正文片段</p>");
    expect(items[0]?.publishedAt).toEqual(new Date("2025-10-03T00:00:00Z"));
  });

  it("Atom:rel=alternate 优先,updated 作时间,summary 作摘要候选", () => {
    const items = parseFeed(ATOM_XML);
    expect(items).toHaveLength(2);
    expect(items[0]?.url).toBe("https://a.com/x");
    expect(items[0]?.publishedAt).toEqual(new Date("2025-10-03T08:00:00Z"));
    expect(items[1]?.url).toBe("https://a.com/real");
  });

  it("两格式都无条目返回空数组(交上层计失败)", () => {
    expect(parseFeed("<html><body>not a feed</body></html>")).toEqual([]);
  });
});

describe("applyToken", () => {
  it("注入 token 保留原参数,无 token 原样", () => {
    expect(applyToken("https://a.com/rss?x=1", "sk-abc")).toBe(
      "https://a.com/rss?x=1&token=sk-abc",
    );
    expect(applyToken("https://a.com/rss", "sk-abc")).toBe("https://a.com/rss?token=sk-abc");
    expect(applyToken("https://a.com/rss", undefined)).toBe("https://a.com/rss");
  });

  it("非法 URL 原样返回", () => {
    expect(applyToken("not a url", "sk-abc")).toBe("not a url");
  });
});

describe("fetchRssItems 错误分型", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("429 → RateLimitedError(供应方限频,非渠道故障)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    await expect(fetchRssItems("https://a.com/rss")).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("其余非 2xx → 普通错误且信息不含 URL(token 不外泄)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(fetchRssItems("https://a.com/rss?token=sk-abc")).rejects.toThrow(
      /^feed HTTP 500$/,
    );
  });
});
