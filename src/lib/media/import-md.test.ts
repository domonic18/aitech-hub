import { describe, expect, it } from "vitest";

import { extractImageRefs, refBasename, replaceImageRefs, summarizeImport } from "./import-md";

describe("extractImageRefs(md + 内联 HTML 双语法)", () => {
  it("md 图片语法与 img 标签都收,按 src 去重", () => {
    const md = [
      "![封面](https://cdn.example.com/a.png)",
      '<img src="https://cdn.example.com/a.png" alt="x">', // 同 src 去重
      "<img src='https://cdn.example.com/b.jpg'>",
      "![本地](./img/local-1.png)",
    ].join("\n");
    const refs = extractImageRefs(md);
    // md 语法先扫、HTML img 后扫(同 src 去重保留首见)
    expect(refs.map((r) => r.src)).toEqual([
      "https://cdn.example.com/a.png",
      "./img/local-1.png",
      "https://cdn.example.com/b.jpg",
    ]);
    expect(refs[0].external).toBe(true);
    expect(refs[1].external).toBe(false); // ./img/local-1.png 相对路径
  });

  it("data: 内联 base64 跳过;带标题的 md 引用也收", () => {
    const md = '![a](data:image/png;base64,AAAA) ![b](https://x.com/y.png "标题")';
    const refs = extractImageRefs(md);
    expect(refs.map((r) => r.src)).toEqual(["https://x.com/y.png"]);
  });

  it("无图片引用返回空数组", () => {
    expect(extractImageRefs("# 纯文字\n\n段落。")).toEqual([]);
  });
});

describe("replaceImageRefs(失败保留原链)", () => {
  const md = [
    "![a](https://old.com/a.png)",
    '<img src="https://old.com/a.png">',
    "<img src='https://old.com/b.jpg'>",
    "![c](https://keep.com/c.png)",
  ].join("\n");

  it("md 与 html 双语法同 src 一起替换;null/缺失保留原链", () => {
    const out = replaceImageRefs(md, {
      "https://old.com/a.png": "/wp-content/uploads/2026/09/a.png",
      "https://old.com/b.jpg": null, // 转存失败 → 保留
      // c 未在 mapping → 保留
    });
    expect(out).toContain("](/wp-content/uploads/2026/09/a.png)");
    expect(out).toContain('src="/wp-content/uploads/2026/09/a.png"');
    expect(out).toContain("src='https://old.com/b.jpg'");
    expect(out).toContain("](https://keep.com/c.png)");
    expect(out).not.toContain("](https://old.com/a.png)");
  });

  it("替换只动引用位置,不伤正文其他文本", () => {
    const src = "前文 https://old.com/a.png 后文\n![x](https://old.com/a.png)";
    const out = replaceImageRefs(src, { "https://old.com/a.png": "/m.png" });
    expect(out.startsWith("前文 https://old.com/a.png 后文")).toBe(true);
    expect(out.endsWith("![x](/m.png)")).toBe(true);
  });
});

describe("refBasename(本地文件按名匹配键)", () => {
  it("取末段并解码;反斜杠路径也认", () => {
    expect(refBasename("https://cdn.com/img/a%20b.png")).toBe("a b.png");
    expect(refBasename("./img/中文图.jpg")).toBe("中文图.jpg");
    expect(refBasename("C:\\imgs\\win.png")).toBe("win.png");
  });
});

describe("summarizeImport(弹窗完成态)", () => {
  it("统计替换数与失败清单", () => {
    const s = summarizeImport({
      "https://a.com/1.png": "/wp-content/uploads/2026/09/1.png",
      "https://a.com/2.png": null,
      "https://a.com/3.png": "/wp-content/uploads/2026/09/3.png",
    });
    expect(s).toEqual({ total: 3, replaced: 2, failed: ["https://a.com/2.png"] });
  });
});
