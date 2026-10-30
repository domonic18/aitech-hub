/** 厂商列表解析单测(M58 批②):三种取数形态 + 日期解析;纯函数零 IO。 */
import { describe, expect, it } from "vitest";

import {
  parseAnthropicNews,
  parseDeepseekSitemap,
  parseKimiBlog,
  parseMonthDayYear,
  parseVendorFeed,
  sortVendorItems,
} from "./parse";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>OpenAI News</title>
    <item>
      <title>Introducing GPT-5.2</title>
      <link>https://openai.com/index/gpt-5-2/</link>
      <pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>Faster &amp; cheaper model.</p>]]></description>
    </item>
    <item>
      <title>GPT-5.2</title>
      <link>https://openai.com/index/gpt-5-2/</link>
      <pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate>
      <description>duplicate url</description>
    </item>
  </channel>
</rss>`;

describe("parseVendorFeed", () => {
  it("RSS:标题/链接/日期/摘要清洗,同 URL 去重", () => {
    const items = parseVendorFeed(RSS, "https://openai.com/news/rss.xml");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Introducing GPT-5.2");
    expect(items[0].url).toBe("https://openai.com/index/gpt-5-2");
    expect(items[0].publishedAt?.toISOString()).toBe("2026-10-26T10:00:00.000Z");
    expect(items[0].summary).toBe("Faster & cheaper model.");
  });
});

// 真机结构(2026-10-30 实探):外层有 article 包裹层,卡片自带 W1FydW_tile /
// W1FydW_featured class;模型发布页在顶级 slug(h2 featured),新闻页在 /news/(h3)
const ANTHROPIC = `<html><body>
<article data-page-top-spacer="condensed"><h1>News</h1>
<section>
<article class="W1FydW_featured">
  <header><p><a class="wN10Da_link" href="/news/announcements">Announcements</a></p><time>Oct 26, 2026</time></header>
  <a class="W1FydW_tileLink" href="/claude-opus-5"><h2 class="tOQyXa_headline-3 W1FydW_featuredTitle">Introducing Claude Opus 5</h2><p class="tOQyXa_body-3 W1FydW_featuredSummary">Our most capable model yet.</p></a>
</article>
<article class="W1FydW_tile">
  <header><time>Oct 20, 2026</time></header>
  <a class="W1FydW_tileLink" href="/news/public-benefit-fund"><h3 class="W1FydW_tileTitle">Investing in the public benefit</h3><p class="tOQyXa_body-3 W1FydW_summary">Fund launch.</p></a>
</article>
<article class="W1FydW_tile"><a class="W1FydW_tileLink" href="/claude-opus-5"><h3 class="W1FydW_tileTitle">重复卡</h3></a></article>
<article class="W1FydW_tile"><h3 class="W1FydW_tileTitle">无链接卡片</h3></article>
<article class="W1FydW_tile"><a class="W1FydW_tileLink" href="https://example.com/x"><h3 class="W1FydW_tileTitle">站外</h3></a></article>
</section></article>
</body></html>`;

describe("parseAnthropicNews", () => {
  it("外层包裹层不截断卡片;顶级 slug 与 /news/ 都收;重复/无链接/站外跳过", () => {
    const items = parseAnthropicNews(ANTHROPIC, "https://www.anthropic.com/news");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Introducing Claude Opus 5",
      url: "https://www.anthropic.com/claude-opus-5",
      summary: "Our most capable model yet.",
    });
    expect(items[0].publishedAt?.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(items[1]).toMatchObject({
      title: "Investing in the public benefit",
      url: "https://www.anthropic.com/news/public-benefit-fund",
      summary: "Fund launch.",
    });
    expect(items[1].publishedAt?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });
});

describe("sortVendorItems", () => {
  it("发布日倒序;无日期稳定保持原序排最后", () => {
    const mk = (title: string, iso: string | null) => ({
      title,
      url: `https://x.test/${title}`,
      publishedAt: iso === null ? null : new Date(iso),
      summary: "",
    });
    const sorted = sortVendorItems([
      mk("a", null),
      mk("b", "2026-10-01T00:00:00Z"),
      mk("c", null),
      mk("d", "2026-10-20T00:00:00Z"),
    ]);
    expect(sorted.map((i) => i.title)).toEqual(["d", "b", "a", "c"]);
  });
});

const KIMI = `<html><body>
<a href="/blog/kimi-k3">Kimi K3 发布</a>
<a href="/blog/kimi-k3">重复</a>
<a href="/about">关于我们</a>
</body></html>`;

describe("parseKimiBlog", () => {
  it("只收 /blog/ 链接,锚文本即标题,无日期", () => {
    const items = parseKimiBlog(KIMI, "https://www.kimi.com/blog");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Kimi K3 发布",
      url: "https://www.kimi.com/blog/kimi-k3",
      publishedAt: null,
    });
  });
});

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset>
  <url><loc>https://api-docs.deepseek.com/news/news251017</loc></url>
  <url><loc>https://api-docs.deepseek.com/news/news260301</loc></url>
  <url><loc>https://api-docs.deepseek.com/news/news0915</loc></url>
  <url><loc>https://api-docs.deepseek.com/quick_start/pricing</loc></url>
</urlset>`;

describe("parseDeepseekSitemap", () => {
  it("只取 news 文章,slug 解日期,按新→旧排序", () => {
    const items = parseDeepseekSitemap(SITEMAP, "https://api-docs.deepseek.com/sitemap.xml");
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.url)).toEqual([
      "https://api-docs.deepseek.com/news/news260301",
      "https://api-docs.deepseek.com/news/news251017",
      "https://api-docs.deepseek.com/news/news0915",
    ]);
    expect(items[0].publishedAt?.toISOString().slice(0, 10)).toBe("2026-03-01");
    // 四位 slug 归 2025(建站年兜底)
    expect(items[2].publishedAt?.toISOString().slice(0, 10)).toBe("2025-09-15");
  });
});

describe("parseMonthDayYear", () => {
  it("合法日期解析;非法月份/文本返回 null", () => {
    expect(parseMonthDayYear("Oct 26, 2026")?.toISOString().slice(0, 10)).toBe("2026-10-26");
    expect(parseMonthDayYear("Foo 26, 2026")).toBeNull();
    expect(parseMonthDayYear("no date")).toBeNull();
  });
});
