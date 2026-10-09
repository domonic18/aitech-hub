import { describe, expect, it } from "vitest";

import { classifyGeoSurface, geoPostIdOf, isGeoSurface } from "./geo";

describe("classifyGeoSurface(2026-10-09 方案A:GEO 机器面路径识别)", () => {
  it("三个面各就各位:llms 索引 / llms-full 分片 / 文章 .md", () => {
    expect(classifyGeoSurface("/llms.txt")).toBe("llms_index");
    expect(classifyGeoSurface("/llms-full.txt")).toBe("llms_full");
    expect(classifyGeoSurface("/llms-full-2.txt")).toBe("llms_full");
    expect(classifyGeoSurface("/llms-full-12.txt")).toBe("llms_full");
    expect(classifyGeoSurface("/post/136-lm-evaluation-harness.md")).toBe("post_md");
    expect(classifyGeoSurface("/post/136.md")).toBe("post_md");
  });

  it("尾斜杠容忍(trailingSlash 口径)", () => {
    expect(classifyGeoSurface("/llms.txt/")).toBe("llms_index");
    expect(classifyGeoSurface("/post/136-foo.md/")).toBe("post_md");
  });

  it("非 GEO 路径一律 null(HTML 页面/feed/sitemap/旧单段 .md 不属机器面)", () => {
    expect(classifyGeoSurface("/post/136-foo")).toBeNull();
    expect(classifyGeoSurface("/post/136-foo.html")).toBeNull();
    expect(classifyGeoSurface("/articles/")).toBeNull();
    expect(classifyGeoSurface("/feed.xml")).toBeNull();
    expect(classifyGeoSurface("/sitemap.xml")).toBeNull();
    expect(classifyGeoSurface("/robots.txt")).toBeNull();
    expect(classifyGeoSurface("/some-slug.md")).toBeNull(); // 旧单段 .md(301 过渡形态)
    expect(classifyGeoSurface("/llms.txt.bak")).toBeNull();
    expect(classifyGeoSurface("/")).toBeNull();
  });

  it("大写形态不入账(rewrites 大小写敏感,大写会 404,统计死链无意义)", () => {
    expect(classifyGeoSurface("/LLMS.txt")).toBeNull();
    expect(classifyGeoSurface("/post/136-foo.MD")).toBeNull();
  });
});

describe("geoPostIdOf", () => {
  it("post_md 面解出 id 锚(id 锚定口径,装饰 slug 不参与)", () => {
    expect(geoPostIdOf("post_md", "/post/136-lm-evaluation-harness.md")).toBe("136");
    expect(geoPostIdOf("post_md", "/post/136.md")).toBe("136");
  });

  it("非 id 形态段返回 null(端点侧记空串,不丢面级计数)", () => {
    expect(geoPostIdOf("post_md", "/post/abc.md")).toBeNull();
  });

  it("llms 两面无文章粒度,恒 null", () => {
    expect(geoPostIdOf("llms_index", "/llms.txt")).toBeNull();
    expect(geoPostIdOf("llms_full", "/llms-full-2.txt")).toBeNull();
  });
});

describe("isGeoSurface(缓冲字段/库列收窄)", () => {
  it("三面枚举内 true,其余 false", () => {
    expect(isGeoSurface("llms_index")).toBe(true);
    expect(isGeoSurface("llms_full")).toBe(true);
    expect(isGeoSurface("post_md")).toBe(true);
    expect(isGeoSurface("page")).toBe(false);
    expect(isGeoSurface("")).toBe(false);
  });
});
