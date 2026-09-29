import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "./html-to-md";

describe("htmlToMarkdown", () => {
  it("空输入返回空串", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
  });

  it("标题与段落", () => {
    const md = htmlToMarkdown("<h2>标题二</h2><p>第一段</p><p>第二段</p>");
    expect(md).toContain("## 标题二");
    expect(md).toContain("第一段\n\n第二段");
  });

  it("行内:加粗/斜体/删除线/行内代码/换行", () => {
    const md = htmlToMarkdown(
      "<p><strong>粗</strong><em>斜</em><del>删</del><code>code</code><br>下一行</p>",
    );
    expect(md).toContain("**粗**");
    expect(md).toContain("*斜*");
    expect(md).toContain("~~删~~");
    expect(md).toContain("`code`");
    expect(md).toContain("\n下一行");
  });

  it("链接与图片", () => {
    const md = htmlToMarkdown(
      '<p><a href="https://example.com">外链</a></p><img src="/wp-content/uploads/a.png" alt="图">',
    );
    expect(md).toContain("[外链](https://example.com)");
    expect(md).toContain("![图](/wp-content/uploads/a.png)");
  });

  it("无序列表与嵌套", () => {
    const md = htmlToMarkdown("<ul><li>一</li><li>二<ul><li>二点一</li></ul></li></ul>");
    expect(md).toContain("- 一");
    expect(md).toContain("- 二\n  - 二点一");
  });

  it("有序列表", () => {
    const md = htmlToMarkdown("<ol><li>甲</li><li>乙</li></ol>");
    expect(md).toContain("1. 甲");
    expect(md).toContain("2. 乙");
  });

  it("引用块逐行加 > 前缀", () => {
    const md = htmlToMarkdown("<blockquote><p>行一</p><p>行二</p></blockquote>");
    // 空行保留 > 前缀(引用内段落连续性)
    expect(md).toContain("> 行一\n>\n> 行二");
  });

  it("pre>code 转围栏并识别 language- 类", () => {
    const md = htmlToMarkdown('<pre><code class="language-python">print(1)\nprint(2)</code></pre>');
    expect(md).toContain("```python\nprint(1)\nprint(2)\n```");
  });

  it("表格转 GFM 管道表并转义竖线", () => {
    const md = htmlToMarkdown(
      "<table><thead><tr><th>A</th><th>B|C</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    expect(md).toContain("| A | B\\|C |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("hr 与 iframe", () => {
    const md = htmlToMarkdown('<p>上</p><hr><iframe src="https://player.bilibili.com/x"></iframe>');
    expect(md).toContain("---");
    expect(md).toContain("[嵌入视频](https://player.bilibili.com/x)");
  });

  it("figure/figcaption 与未列标签剥壳留文本", () => {
    const md = htmlToMarkdown(
      '<figure><img src="/a.png" alt="题图"><figcaption>说明</figcaption></figure><video src="/v.mp4"></video>',
    );
    expect(md).toContain("![题图](/a.png)");
    expect(md).toContain("*说明*");
    expect(md).toContain("/v.mp4"); // video 剥壳保留文本
  });
});
