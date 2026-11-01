/**
 * 社区语料解析单测(M58 批④):四类真实响应形态 → 统一入池条目。
 * 夹具取自 2026-10-30 真机响应的字段子集(裁剪无关字段)。
 */
import { describe, expect, it } from "vitest";

import {
  detectLang,
  parseBaiduSuggest,
  parseGithubIssues,
  parseHackerNews,
  parseV2ex,
} from "./parse";

describe("parseHackerNews", () => {
  const raw = JSON.stringify({
    hits: [
      {
        objectID: "50299880",
        title: "Show HN: DistractFree – stop doomscrolling",
        url: "https://distractfree.site/",
        author: "ramthokane",
        created_at_i: 1793334691,
        points: 1,
        num_comments: 0,
      },
      { objectID: "50299000", title: "Ask HN: How do you evaluate AI agents?", url: null },
      { objectID: "50299001", title: "", url: "https://x.test" },
    ],
  });

  it("标题入池、Ask HN 回退讨论页、空标题跳过", () => {
    const items = parseHackerNews(raw);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      refId: "hn:50299880",
      lang: "en",
      url: "https://distractfree.site/",
    });
    expect(items[0].signalAt?.toISOString()).toBe("2026-10-30T04:31:31.000Z");
    expect(items[1].url).toBe("https://news.ycombinator.com/item?id=50299000");
    expect(items[1].signalAt).toBeNull();
  });

  it("非 JSON / 缺 hits 返回空(上层计源失败)", () => {
    expect(parseHackerNews("<html>")).toEqual([]);
    expect(parseHackerNews("{}")).toEqual([]);
  });
});

describe("parseV2ex", () => {
  const raw = JSON.stringify([
    {
      id: 1253099,
      title: "各位是怎么应对 GPT 废话过多的问题的?",
      created: 1793334716,
      replies: 12,
      node: { name: "openai", title: "OpenAI" },
    },
    { id: 0, title: "" },
  ]);

  it("主题标题 + 站内链接 + 节点/回复数 meta", () => {
    const items = parseV2ex(raw);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      refId: "v2ex:1253099",
      url: "https://www.v2ex.com/t/1253099",
      lang: "zh",
      meta: { replies: 12, node: "openai", nodeTitle: "OpenAI" },
    });
  });
});

describe("parseBaiduSuggest", () => {
  const raw = 'cb({q:"ai编程",p:true,s:["ai编程软件","ai编程工具排名","ai编程软件",""]});';

  it("剥 JSONP 包裹,词条去重,refId=bd:<sha1(seed\\0word)>", () => {
    const items = parseBaiduSuggest(raw, "AI 编程");
    expect(items.map((i) => i.text)).toEqual(["ai编程软件", "ai编程工具排名"]);
    expect(items[0].refId).toMatch(/^bd:[0-9a-f]{40}$/);
    expect(items[0].refId).not.toBe(items[1].refId);
    expect(items[0].meta).toEqual({ seed: "AI 编程" });
  });

  it("同一 seed+word 的 refId 恒定(跨日重跑幂等)", () => {
    expect(parseBaiduSuggest(raw, "AI 编程")[0].refId).toBe(
      parseBaiduSuggest(raw, "AI 编程")[0].refId,
    );
    expect(parseBaiduSuggest(raw, "AI 创作")[0].refId).not.toBe(
      parseBaiduSuggest(raw, "AI 编程")[0].refId,
    );
  });

  it("非 JSONP 返回空", () => {
    expect(parseBaiduSuggest("oops", "x")).toEqual([]);
  });
});

describe("parseGithubIssues", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  function issue(over: Record<string, unknown>): Record<string, unknown> {
    return {
      number: 1,
      title: "[Bug] 切换供应商后配置丢失",
      body: "复现步骤……",
      html_url: "https://github.com/farion1231/cc-switch/issues/1",
      created_at: "2026-10-01T00:00:00Z",
      labels: [],
      ...over,
    };
  }
  const raw = JSON.stringify([
    issue({ number: 11, title: "[Feature] 支持余额提醒" }),
    issue({ number: 12, title: "托盘图标不显示", labels: [{ name: "bug" }] }),
    issue({ number: 13, title: "Update README", labels: [] }),
    issue({ number: 14, title: "[Bug] 已超窗口", created_at: "2026-01-01T00:00:00Z" }),
    issue({ number: 15, title: "Fix typo", pull_request: { url: "x" } }),
    issue({ number: 16, title: "英文标题 bug report", labels: [{ name: "Enhancement" }] }),
  ]);

  it("只收窗口内 open 的 bug/feature(标签或标题前缀)+ 剔除 PR", () => {
    const items = parseGithubIssues(raw, "farion1231/cc-switch", now);
    expect(items.map((i) => i.refId)).toEqual([
      "farion1231/cc-switch#11",
      "farion1231/cc-switch#12",
      "farion1231/cc-switch#16",
    ]);
  });

  it("正文截断 2000(标题 + 正文总长受控),语言按中英文占比", () => {
    const long = JSON.stringify([
      issue({ number: 21, body: "长".repeat(5000) }),
      issue({
        number: 22,
        title: "[Feature] Support streaming",
        body: "Please add streaming support",
      }),
    ]);
    const items = parseGithubIssues(long, "chenhg5/cc-connect", now);
    expect(items[0].text.length).toBeLessThan(2100);
    expect(items[0].text.endsWith("长")).toBe(true);
    expect(items[0].lang).toBe("zh");
    expect(items[1].lang).toBe("en");
  });
});

describe("detectLang", () => {
  it("中文为主 → zh;英文为主 → en", () => {
    expect(detectLang("希望支持 Claude Code 的 Windows 版本")).toBe("zh");
    expect(detectLang("Add support for Windows arm64 builds")).toBe("en");
  });
});
