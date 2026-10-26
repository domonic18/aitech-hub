/**
 * 公众号码点预算计量单测(M30 批③):分解自洽(总=纯文本+标记)/表格段
 * 识别/超限判定/主题缺省回退;renderWechatHtml 真函数(纯 markdown-it,零 IO)。
 */
import { describe, expect, it } from "vitest";

import { WECHAT_CONTENT_MAX_CHARS } from "./channels";
import { measureWechatBudget } from "./wechat-budget";
import { renderWechatHtml } from "./wechat-html";

describe("measureWechatBudget", () => {
  it("分解自洽:总 = 纯文本 + 标记;表格段计入且 ≤ 总", () => {
    const md = `# 标题\n\n一段**加粗**与[链接](https://example.com)。\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n`;
    const b = measureWechatBudget(md);
    const html = renderWechatHtml(md).html;
    expect(b.totalChars).toBe([...html].length);
    expect(b.totalChars).toBe(b.plainChars + b.markupChars);
    expect(b.tableChars).toBeGreaterThan(0);
    expect(b.tableChars).toBeLessThan(b.totalChars);
    expect(b.plainChars).toBe([...html.replace(/<[^>]+>/g, "")].length);
    expect(b.overBudget).toBe(false);
    expect(b.usagePct).toBe(Math.round((b.totalChars / WECHAT_CONTENT_MAX_CHARS) * 100));
  });

  it("无表格 → tableChars=0;码点按 Unicode 码位计(中文非转义)", () => {
    const b = measureWechatBudget("普通中文段落,没有表格。");
    expect(b.tableChars).toBe(0);
    expect(b.plainChars).toBe(
      [...renderWechatHtml("普通中文段落,没有表格。").html.replace(/<[^>]+>/g, "")].length,
    );
  });

  it("超限判定:超长正文 overBudget=true 且 usagePct>100", () => {
    const b = measureWechatBudget("超长".repeat(15_000));
    expect(b.overBudget).toBe(true);
    expect(b.usagePct).toBeGreaterThan(100);
  });

  it("themeId 未知回退默认主题,渲染永不抛", () => {
    const md = "# t";
    const b1 = measureWechatBudget(md, "no-such-theme");
    const b2 = measureWechatBudget(md);
    expect(b1.totalChars).toBe(b2.totalChars);
  });
});
