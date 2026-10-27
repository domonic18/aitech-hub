/**
 * 公众号 HTML 管线单测(纯函数):全局继承节+差异声明(体积纪律)、元素内联
 * 样式覆盖、代码转义、外链编号与 References(去重/上限/内链不编号)、h5+
 * 降级加粗段、嵌套列表展平(微信兼容)。
 */
import { describe, expect, it } from "vitest";

import { WECHAT_REFERENCE_MAX } from "./channels";
import { renderWechatHtml } from "./wechat-html";

describe("renderWechatHtml 全局节与差异声明", () => {
  it("全局节一次性声明可继承属性;段落只写 margin 差异", () => {
    const { html } = renderWechatHtml("正文一段");
    expect(html).toMatch(
      /^<section style="font-size:15px;color:#3f3f46;line-height:1\.75;"><p style="margin:12px 0;">正文一段<\/p><\/section>$/,
    );
    // 可继承声明不得在元素级重复(体积纪律)
    expect(html).not.toContain('style="margin:12px 0;font-size:15px');
  });

  it("段落/加粗/行内码/引用", () => {
    const { html } = renderWechatHtml("正文**加粗**与`code`。\n\n> 引用一句");
    expect(html).toContain('<strong style="font-weight:600;color:#1f2328;">加粗</strong>');
    expect(html).toContain("<code style=");
    expect(html).toContain(">code</code>");
    expect(html).toContain("background-color:#f6f8fa");
    expect(html).toContain("引用一句");
  });

  it("标题阶梯:h2 带主题色左竖条;h5 降级为加粗段 <p>(字号继承)", () => {
    const { html } = renderWechatHtml("## 二级\n\n##### 五级");
    expect(html).toContain(
      '<h2 style="margin:24px 0 12px;font-size:17px;font-weight:600;color:#1f2328;line-height:1.4;border-left:3px solid #1f2328;padding-left:10px;">',
    );
    expect(html).toContain("</h2>");
    expect(html).not.toContain("<h5");
    expect(html).toContain('<p style="margin:16px 0 8px;font-weight:600;color:#1f2328;">');
    expect(html).toContain("五级</p>");
  });

  it("代码块暗底单色且转义 HTML;行内 <script> 不执行", () => {
    const { html } = renderWechatHtml("```js\nconst a = '<script>';\n```");
    expect(html).toContain("background-color:#0d1117");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("代码块行间 <br>+缩进 &nbsp;(M50 修复:微信粘贴管线折叠裸换行)", () => {
    const { html } = renderWechatHtml("```yaml\n目标:\n  1、缩进行\n\n下一段\n```");
    expect(html).toContain("<br>");
    expect(html).not.toContain("white-space:pre-wrap");
    expect(html).toContain("&nbsp;&nbsp;1、缩进行");
    // 空行 = 相邻 <br>(块元素空行仍占行高)
    expect(html).toContain("<br><br>");
  });

  it("表格全内联(th 底色+td 边框);hr 转边框 section", () => {
    const { html } = renderWechatHtml("| a | b |\n| - | - |\n| 1 | 2 |\n\n---");
    expect(html).toContain("<table");
    expect(html).toContain(
      '<th style="padding:6px 10px;text-align:left;border:1px solid #ddd;background-color:#f6f8fa;">',
    );
    expect(html).toContain('<td style="padding:6px 10px;border:1px solid #ddd;">');
    expect(html).toContain('<section style="border:none;border-top:1px solid #d0d7de');
  });

  it("图片带内联样式并保留 alt", () => {
    const { html } = renderWechatHtml("![截图](https://mmbiz.qpic.cn/x.png)");
    expect(html).toContain('style="max-width:100%;border-radius:4px');
    expect(html).toContain('alt="截图"');
    expect(html).toContain('src="https://mmbiz.qpic.cn/x.png"');
  });

  it("列表一律展平为 section+行内标记(M50 修复:微信对 li 内带样式行内元素断行)", () => {
    const { html } = renderWechatHtml("- 甲\n- 乙\n\n1. 丙");
    expect(html).not.toMatch(/<(ul|ol|li)\b/);
    expect(html).toContain('<section style="margin-left:1em;">• 甲</section>');
    expect(html).toContain('<section style="margin-left:1em;">• 乙</section>');
    expect(html).toContain('<section style="margin-left:1em;">1. 丙</section>');
  });
});

describe("嵌套列表展平(微信兼容)", () => {
  it("ul 嵌 ul:内外全展平,零 list 标签残留(M50 修复后顶层同样展平)", () => {
    const { html } = renderWechatHtml("- 甲\n  - 甲一\n  - 甲二\n- 乙");
    expect(html).not.toMatch(/<(ul|ol|li)\b/);
    expect(html).toContain('<section style="margin-left:1em;">• 甲一</section>');
    expect(html).toContain('<section style="margin-left:1em;">• 甲二</section>');
    expect(html).toContain("乙");
  });

  it("ol 嵌 ul:内层 • 标记;ol 嵌 ol:内层数字标记按 start 接续", () => {
    const { html } = renderWechatHtml("1. 一\n   - 子一\n   - 子二\n2. 二");
    expect(html).toContain('<section style="margin-left:1em;">• 子一</section>');
    expect(html).toContain('<section style="margin-left:1em;">• 子二</section>');
    const { html: html2 } = renderWechatHtml("1. 一\n\n   3. 子甲\n   4. 子乙\n\n2. 二");
    expect(html2).toContain('<section style="margin-left:1em;">3. 子甲</section>');
    expect(html2).toContain('<section style="margin-left:1em;">4. 子乙</section>');
  });

  it("顶层列表同样展平(2026-10-27 生产实收:微信在 li 内带样式行内元素处断行)", () => {
    const { html } = renderWechatHtml("1. **加粗项**。后续正文接排不换行。");
    expect(html).not.toMatch(/<(ul|ol|li)\b/);
    expect(html).toContain(
      '<section style="margin-left:1em;">1. <strong style="font-weight:600;color:',
    );
    expect(html).toContain("</strong>。后续正文接排不换行。</section>");
  });

  it("引用块内嵌套列表同样展平", () => {
    const { html } = renderWechatHtml("> 引述\n> - 甲\n>   - 子");
    expect(html).toContain("<blockquote");
    expect(html).toContain('<section style="margin-left:1em;">• 子</section>');
  });
});

describe("外链编号与 References", () => {
  it("外链:文字染色 + [1] 角标,文末 References 含 href;内链不编号", () => {
    const { html, refs } = renderWechatHtml("[站内](/post/1-x) 与 [Google](https://google.com)");
    expect(html).toContain("[1]</sup>");
    expect(html).toContain("References</p>");
    expect(html).toContain("[1] Google(https://google.com)</p>");
    expect(refs).toEqual(["https://google.com"]);
    expect(html).toContain('<span style="color:#576b95;">站内</span>');
  });

  it("同 href 去重同号", () => {
    const { refs } = renderWechatHtml("[a](https://x.com) 与 [b](https://x.com)");
    expect(refs).toEqual(["https://x.com"]);
  });

  it(`References 上限 ${WECHAT_REFERENCE_MAX} 条:超出只染色不编号`, () => {
    const links = Array.from(
      { length: WECHAT_REFERENCE_MAX + 3 },
      (_, i) => `[l${i}](https://ex.com/${i})`,
    ).join(" 与 ");
    const { refs, html } = renderWechatHtml(links);
    expect(refs).toHaveLength(WECHAT_REFERENCE_MAX);
    expect(html).not.toContain(`[${WECHAT_REFERENCE_MAX + 1}]</sup>`);
  });

  it("无外链不出 References 节", () => {
    const { html, refs } = renderWechatHtml("纯中文正文,无链接");
    expect(refs).toEqual([]);
    expect(html).not.toContain("References");
  });

  it("嵌套加粗链接:References 回退 URL;链接内图片场景不炸", () => {
    const { refs, html } = renderWechatHtml("[**加粗外链**](https://ex.com/a)");
    expect(refs).toEqual(["https://ex.com/a"]);
    expect(html).toContain("[1]</sup>");
    expect(html).toContain("[1] https://ex.com/a</p>");
  });
});

describe("renderWechatHtml 主题(wechat-themes)", () => {
  const MD = "## 绿色标题\n\n**重点**与`code`。\n\n> 引用\n\n[外链](https://ex.com/a)";

  it("green 主题:标题/加粗/引用/行内码/链接角标随主题变色,正文段落保持深灰", () => {
    const { html } = renderWechatHtml(MD, "green");
    expect(html).toContain("font-size:17px;font-weight:600;color:#2b9939;"); // h2
    expect(html).toContain('<strong style="font-weight:600;color:#2b9939;">重点</strong>');
    expect(html).toContain("border-left:3px solid #2b9939;background-color:#f0f9f1");
    expect(html).toContain("color:#1e7e34;"); // 行内码
    expect(html).toContain('<span style="color:#2b9939;">'); // 链接
    expect(html).toContain('<sup style="color:#2b9939;font-size:11px;">[1]</sup>');
    expect(html).toContain('style="font-size:15px;color:#3f3f46;line-height:1.75;"'); // 全局深灰不变
    expect(html).not.toContain("#1f2328"); // 默认标题色不出现
  });

  it("缺省/未知主题 id 回退默认主题(渲染永不抛)", () => {
    const fallback = renderWechatHtml(MD);
    expect(renderWechatHtml(MD, undefined).html).toBe(fallback.html);
    expect(renderWechatHtml(MD, "not-a-theme").html).toBe(fallback.html);
    expect(fallback.html).toContain("color:#1f2328;"); // 默认标题黑
    expect(fallback.html).not.toContain("#2b9939");
  });
});
