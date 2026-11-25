import { describe, expect, it } from "vitest";

import {
  buildLegacyPath,
  decideLegacy,
  decideWpPost,
  tagRedirectTarget,
  wpQueryTarget,
} from "./legacy-decide";

describe("decideLegacy(standard/01-testing §2.5:命中 301 / NULL→410 / 未命中 404)", () => {
  it("命中且有目标 → redirect", () => {
    expect(decideLegacy({ targetUrl: "/articles", httpStatus: 301 })).toBe("redirect");
  });

  it("命中但目标为 NULL → gone(410)", () => {
    expect(decideLegacy({ targetUrl: null, httpStatus: 301 })).toBe("gone");
  });

  it("未命中 → notfound(404)", () => {
    expect(decideLegacy("miss")).toBe("notfound");
  });
});

describe("buildLegacyPath(路径段 → 表内 oldPath 形态)", () => {
  it("单段中文:解码入参归一为编码形态并包裹斜杠", () => {
    expect(buildLegacyPath(["【工具技巧】收藏"])).toBe(
      `/${encodeURIComponent("【工具技巧】收藏").toLowerCase()}/`,
    );
  });

  it("已是编码形态:幂等", () => {
    const encoded = encodeURIComponent("标签").toLowerCase();
    expect(buildLegacyPath([encoded])).toBe(`/${encoded}/`);
  });

  it("多段:逐段归一", () => {
    // 字面大写不转小写(normalizeSlug 仅归一 %XX 十六进制),中文段转 percent-encoded
    expect(buildLegacyPath(["tag", "AI"])).toBe("/tag/AI/");
  });
});

describe("decideWpPost(/?p=<wpId> 承接:已发布 301,其余一律 410)", () => {
  it("命中且已发布 → redirect", () => {
    expect(decideWpPost({ id: "127", slug: "llama-factory", status: "published" })).toBe(
      "redirect",
    );
  });

  it("命中但草稿/下架 → gone(不暴露未发布内容)", () => {
    expect(decideWpPost({ id: "127", slug: null, status: "draft" })).toBe("gone");
    expect(decideWpPost({ id: "127", slug: "x", status: "deleted" })).toBe("gone");
  });

  it("未命中(弃用资讯/已物理删) → gone(410 不给爬虫重试理由)", () => {
    expect(decideWpPost("miss")).toBe("gone");
  });
});

describe("wpQueryTarget(?p= 参数 → middleware rewrite 目标,纯函数判形)", () => {
  it("合法数字 id → /legacy/wp-p/<id>/", () => {
    expect(wpQueryTarget("36251")).toBe("/legacy/wp-p/36251/");
    expect(wpQueryTarget("1")).toBe("/legacy/wp-p/1/");
    // int64 上限本体合法
    expect(wpQueryTarget("9223372036854775807")).toBe("/legacy/wp-p/9223372036854775807/");
  });

  it("非数字/超界/空/null → null 放行(首页照常渲染)", () => {
    expect(wpQueryTarget("abc")).toBeNull();
    expect(wpQueryTarget("36251x")).toBeNull();
    expect(wpQueryTarget("-1")).toBeNull();
    expect(wpQueryTarget("9223372036854775808")).toBeNull(); // int64 溢出
    expect(wpQueryTarget("")).toBeNull();
    expect(wpQueryTarget(null)).toBeNull();
  });
});

describe("tagRedirectTarget(/?tag=<名> → /tag/<归一 slug>/,真跳转 301)", () => {
  it("明文中文 → percent-encoded 小写形态(对齐 DB slug)", () => {
    expect(tagRedirectTarget("多模态")).toBe("/tag/%e5%a4%9a%e6%a8%a1%e6%80%81/");
  });

  it("已是 percent-encoded 形态:幂等归一", () => {
    expect(tagRedirectTarget("%E5%A4%9A%E6%A8%A1%E6%80%81")).toBe(
      "/tag/%e5%a4%9a%e6%a8%a1%e6%80%81/",
    );
  });

  it("ASCII tag 原样(大小写保留:normalizeSlug 只小写 %XX 十六进制)", () => {
    expect(tagRedirectTarget("AI")).toBe("/tag/AI/");
  });

  it("null/空/纯空格 → null 放行", () => {
    expect(tagRedirectTarget(null)).toBeNull();
    expect(tagRedirectTarget("")).toBeNull();
    expect(tagRedirectTarget("   ")).toBeNull();
  });

  it("超长 fuzz(归一产物超 slug 列宽)→ null 放行,不产巨型 301", () => {
    expect(tagRedirectTarget("x".repeat(300))).toBeNull();
  });
});
