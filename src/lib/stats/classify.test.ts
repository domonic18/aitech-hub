import { describe, expect, it } from "vitest";

import { classifyReferrer, isBotUa, normalizePagePath, parseClient, visitorHash } from "./classify";

describe("isBotUa(requirement §3.5 去爬虫口径)", () => {
  it("已知爬虫/预览器 → true", () => {
    expect(isBotUa("Mozilla/5.0 (compatible; Baiduspider/2.0)")).toBe(true);
    expect(isBotUa("Mozilla/5.0 HeadlessChrome/120")).toBe(true);
    expect(isBotUa("curl/8.4.0")).toBe(true);
    expect(isBotUa("python-requests/2.31")).toBe(true);
  });

  it("正常浏览器 → false", () => {
    expect(
      isBotUa(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
  });

  it("空 UA 按非浏览器处理", () => {
    expect(isBotUa("")).toBe(true);
    expect(isBotUa(null)).toBe(true);
  });
});

describe("classifyReferrer(四类来源,AI 类目是 GEO 核心观测)", () => {
  it("空 referer → direct/none", () => {
    expect(classifyReferrer(null)).toEqual({ sourceClass: "direct", sourceName: "none" });
    expect(classifyReferrer("")).toEqual({ sourceClass: "direct", sourceName: "none" });
  });

  it("搜索引擎细分", () => {
    expect(classifyReferrer("https://www.google.com/")).toEqual({
      sourceClass: "search",
      sourceName: "google",
    });
    expect(classifyReferrer("https://www.baidu.com/s?wd=ai")).toEqual({
      sourceClass: "search",
      sourceName: "baidu",
    });
    expect(classifyReferrer("https://cn.bing.com/")).toEqual({
      sourceClass: "search",
      sourceName: "bing",
    });
  });

  it("AI 助手优先于搜索引擎判定(gemini.google.com)", () => {
    expect(classifyReferrer("https://gemini.google.com/app")).toEqual({
      sourceClass: "ai",
      sourceName: "gemini",
    });
    expect(classifyReferrer("https://chatgpt.com/")).toEqual({
      sourceClass: "ai",
      sourceName: "chatgpt",
    });
    expect(classifyReferrer("https://www.perplexity.ai/search")).toEqual({
      sourceClass: "ai",
      sourceName: "perplexity",
    });
    expect(classifyReferrer("https://kimi.moonshot.cn/")).toEqual({
      sourceClass: "ai",
      sourceName: "kimi",
    });
  });

  it("其余站外域 → referral/域名", () => {
    expect(classifyReferrer("https://juejin.cn/post/123")).toEqual({
      sourceClass: "referral",
      sourceName: "juejin.cn",
    });
  });

  it("非法串按 direct 处理", () => {
    expect(classifyReferrer("::::")).toEqual({ sourceClass: "direct", sourceName: "none" });
  });
});

describe("parseClient(访客环境,展示简版)", () => {
  it("Windows Chrome 桌面", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    expect(parseClient(ua)).toEqual({ browser: "Chrome", os: "Windows", deviceType: "desktop" });
  });

  it("iPhone Safari 移动端", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseClient(ua)).toEqual({ browser: "Safari", os: "iOS", deviceType: "mobile" });
  });

  it("微信内置浏览器", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.42";
    expect(parseClient(ua).browser).toBe("WeChat");
  });

  it("iPad 归 tablet", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
    expect(parseClient(ua).deviceType).toBe("tablet");
  });
});

describe("visitorHash(IP+UA 匿名化,不存明文 IP)", () => {
  it("同输入同输出,不同输入不同输出", () => {
    expect(visitorHash("salt", "1.2.3.4", "UA")).toBe(visitorHash("salt", "1.2.3.4", "UA"));
    expect(visitorHash("salt", "1.2.3.4", "UA")).not.toBe(visitorHash("salt", "1.2.3.5", "UA"));
    expect(visitorHash("salt", "1.2.3.4", "UA")).not.toBe(visitorHash("salt2", "1.2.3.4", "UA"));
  });

  it("输出为定长十六进制,不含 IP 明文", () => {
    const h = visitorHash("salt", "192.168.1.100", "Chrome");
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("192.168.1.100");
  });
});

describe("normalizePagePath", () => {
  it("去掉查询串与锚点,补前导斜杠,限长 500", () => {
    expect(normalizePagePath("/articles/?page=2#top")).toBe("/articles/");
    expect(normalizePagePath("articles")).toBe("/articles");
    expect(normalizePagePath(`/${"a".repeat(600)}/`)).toHaveLength(500);
  });
});
