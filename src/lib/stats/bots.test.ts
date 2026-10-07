/**
 * bots 单测:AI/搜索爬虫指纹识别、细粒度优先(Applebot-Extended 先于
 * Applebot)、未识别 null、botKindOf 兜底 other。
 */
import { describe, expect, it } from "vitest";

import { botKindOf, classifyBotUa } from "./bots";

describe("classifyBotUa", () => {
  it("AI 爬虫指纹 → 名字 + ai", () => {
    expect(
      classifyBotUa("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"),
    ).toEqual({ name: "GPTBot", kind: "ai" });
    expect(
      classifyBotUa("Mozilla/5.0 (compatible) ClaudeBot/1.0 (+claudebot@anthropic.com)"),
    ).toEqual({ name: "ClaudeBot", kind: "ai" });
    expect(classifyBotUa("Mozilla/5.0 (compatible; PerplexityBot/1.0; ...)")).toEqual({
      name: "PerplexityBot",
      kind: "ai",
    });
    expect(classifyBotUa("Mozilla/5.0 (compatible; Google-Extended/1.0)")).toEqual({
      name: "Google-Extended",
      kind: "ai",
    });
    expect(
      classifyBotUa("Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)"),
    ).toEqual({ name: "Bytespider", kind: "ai" });
  });

  it("搜索引擎爬虫 → 名字 + search", () => {
    expect(
      classifyBotUa("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    ).toEqual({ name: "Googlebot", kind: "search" });
    expect(
      classifyBotUa("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"),
    ).toEqual({ name: "bingbot", kind: "search" });
    expect(
      classifyBotUa("Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com)"),
    ).toEqual({ name: "Baiduspider", kind: "search" });
  });

  it("同厂商细粒度优先:Applebot-Extended 不落 Applebot,ChatGPT-User 不落 GPTBot 系", () => {
    expect(classifyBotUa("Mozilla/5.0 (compatible; Applebot-Extended; ...)")).toEqual({
      name: "Applebot-Extended",
      kind: "ai",
    });
    expect(classifyBotUa("Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com)")).toEqual({
      name: "Applebot",
      kind: "search",
    });
    expect(classifyBotUa("Mozilla/5.0 AppleWebKit; ChatGPT-User; ...")).toEqual({
      name: "ChatGPT-User",
      kind: "ai",
    });
  });

  it("空/普通浏览器/未识别 UA → null", () => {
    expect(classifyBotUa(null)).toBeNull();
    expect(classifyBotUa(undefined)).toBeNull();
    expect(classifyBotUa("")).toBeNull();
    expect(
      classifyBotUa(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      ),
    ).toBeNull();
    expect(classifyBotUa("curl/8.4.0")).toBeNull(); // 名单外工具:宁缺勿滥
  });

  it("botKindOf:名单内回类别,未知名兜 other", () => {
    expect(botKindOf("GPTBot")).toBe("ai");
    expect(botKindOf("Googlebot")).toBe("search");
    expect(botKindOf("某个退役名单外的爬虫")).toBe("other");
  });
});
