import { describe, expect, it } from "vitest";

import { buildPostToc, buildTocFromMarkdown, injectHeadingIds } from "./toc";

describe("buildTocFromMarkdown(与 react-markdown 同款 slug)", () => {
  it("只收 H2/H3,标题文本去格式", () => {
    const md = [
      "# 文章大标题",
      "## 第一节",
      "正文",
      "### 1.1 `code` 与 **加粗**",
      "#### 太深不收录",
      "## 第二节",
    ].join("\n\n");
    expect(buildTocFromMarkdown(md)).toEqual([
      { id: "第一节", text: "第一节", level: 2 },
      { id: "11-code-与-加粗", text: "1.1 code 与 加粗", level: 3 },
      { id: "第二节", text: "第二节", level: 2 },
    ]);
  });

  it("重复标题按文档顺序去重(-1 后缀)", () => {
    const toc = buildTocFromMarkdown("## 小节\n\n## 小节\n\n### 小节");
    expect(toc.map((t) => t.id)).toEqual(["小节", "小节-1", "小节-2"]);
  });

  it("代码块里的 # 不算标题", () => {
    const md = ["## 真标题", "```bash", "# 注释不是标题", "## 也不是", "```"].join("\n");
    expect(buildTocFromMarkdown(md).map((t) => t.text)).toEqual(["真标题"]);
  });

  it("HTML 形式书写的标题同样进目录(rehype-raw 解析)", () => {
    const md = "<h2>裸 HTML 标题</h2>\n\n<h3>二级 <code>x</code></h3>";
    expect(buildTocFromMarkdown(md)).toEqual([
      { id: "裸-html-标题", text: "裸 HTML 标题", level: 2 },
      { id: "二级-x", text: "二级 x", level: 3 },
    ]);
  });

  it("空正文/无标题 → 空目录,不抛错", () => {
    expect(buildTocFromMarkdown("")).toEqual([]);
    expect(buildTocFromMarkdown("只有一段正文。")).toEqual([]);
  });
});

describe("injectHeadingIds(旧 content_html 保真注入)", () => {
  it("无 id 时按文档顺序注入,正文其余字节不变", () => {
    const html = '<p>前言</p>\n<h2>章节一</h2>\n<p>内容</p>\n<h3 class="x">小节</h3>';
    const { html: out, toc } = injectHeadingIds(html);
    expect(out).toBe(
      '<p>前言</p>\n<h2 id="章节一">章节一</h2>\n<p>内容</p>\n<h3 id="小节" class="x">小节</h3>',
    );
    expect(toc).toEqual([
      { id: "章节一", text: "章节一", level: 2 },
      { id: "小节", text: "小节", level: 3 },
    ]);
  });

  it("重复标题去重,幂等(重复注入结果一致)", () => {
    const html = "<h2>同名</h2><h2>同名</h2>";
    const first = injectHeadingIds(html);
    expect(first.toc.map((t) => t.id)).toEqual(["同名", "同名-1"]);
    expect(first.html).toBe('<h2 id="同名">同名</h2><h2 id="同名-1">同名</h2>');
    expect(injectHeadingIds(first.html)).toEqual(first);
  });

  it("已有 id 被重写为同款 slug,不叠加属性", () => {
    const { html: out, toc } = injectHeadingIds('<h2 id="user-content-old" data-x="1">新标题</h2>');
    expect(out).toBe('<h2 id="新标题" data-x="1">新标题</h2>');
    expect(toc).toEqual([{ id: "新标题", text: "新标题", level: 2 }]);
  });

  it("跨行开标签与实体文本都能命中", () => {
    const { toc } = injectHeadingIds('<h2\n  class="a"\n>A &amp; B</h2>');
    expect(toc).toEqual([{ id: "a--b", text: "A & B", level: 2 }]);
  });

  it("h1/h4 不注入、不进目录", () => {
    const { html: out, toc } = injectHeadingIds("<h1>大标题</h1><h4>太深</h4>");
    expect(out).toBe("<h1>大标题</h1><h4>太深</h4>");
    expect(toc).toEqual([]);
  });
});

describe("buildPostToc(页面唯一出口)", () => {
  it("md 优先,不改 html 字段", () => {
    const r = buildPostToc({ contentMd: "## 标题", contentHtml: "<h2>旧</h2>" });
    expect(r.contentHtml).toBeUndefined();
    expect(r.toc.map((t) => t.text)).toEqual(["标题"]);
  });

  it("无 md 时走旧 html,返回注入后的 html", () => {
    const r = buildPostToc({ contentMd: null, contentHtml: "<h2>旧标题</h2>" });
    expect(r.contentHtml).toBe('<h2 id="旧标题">旧标题</h2>');
    expect(r.toc).toEqual([{ id: "旧标题", text: "旧标题", level: 2 }]);
  });

  it("门禁文按预览 md 取目录", () => {
    const r = buildPostToc({ contentMd: "## 全文标题", previewMd: "## 预览可见标题" });
    expect(r.toc.map((t) => t.text)).toEqual(["预览可见标题"]);
  });

  it("全空 → 空目录", () => {
    expect(buildPostToc({ contentMd: null, contentHtml: null })).toEqual({ toc: [] });
  });
});
