import { describe, expect, it } from "vitest";

import { buildLegacyPath, decideLegacy } from "./legacy-decide";

describe("decideLegacy(06 文档 §2.5:命中 301 / NULL→410 / 未命中 404)", () => {
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
