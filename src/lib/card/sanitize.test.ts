/**
 * 消毒器单测(M31 批B 建,2026-10-18 宽容化修订):安全红线不变——危险标签/
 * 事件属性/js URL/外链 img/超量 img/style 外联全部整体报错;渲染宽容——文档
 * 结构标签静默摘除、无害未知标签解包放行、id 与表格跨列属性保留;输出壳为
 * 深空基线(模型自带样式后置可覆盖)。
 */
import { describe, expect, it } from "vitest";

import { sanitizeCardHtml } from "./sanitize";

describe("sanitizeCardHtml", () => {
  it("干净 HTML → ok,输出带独立文档壳与深空基线", () => {
    const r = sanitizeCardHtml(
      '<div class="card"><h2>标题</h2><p>正文 <strong>加粗</strong></p></div>',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(r.html).toContain("<h2>标题</h2>");
      expect(r.html).toContain('class="card"');
      expect(r.html).toContain("background:#0b1220");
      expect(r.html).toContain("Noto Sans CJK SC");
    }
  });

  it("整份文档输入 → meta/title 摘除、html/head/body 解包、doctype 去重,不算违规", () => {
    const r = sanitizeCardHtml(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>卡</title></head>' +
        '<body><div class="k"><h3>T</h3></div></body></html>',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html).toContain('<div class="k"><h3>T</h3></div>');
      expect(r.html).not.toContain("<title>");
      // 只剩输出壳自带的各一处(输入侧的已摘/解包)
      expect(r.html.match(/<!DOCTYPE/g)?.length).toBe(1);
      expect(r.html.match(/<html/g)?.length).toBe(1);
      expect(r.html.match(/<meta/g)?.length).toBe(1);
      expect(r.html.match(/<body/g)?.length).toBe(1);
    }
  });

  it("危险标签整体报错", () => {
    for (const frag of [
      "<script>alert(1)</script>",
      "<iframe src='//x'></iframe>",
      "<svg onload='x'></svg>",
    ]) {
      const r = sanitizeCardHtml(`<div>${frag}</div>`);
      expect(r.ok).toBe(false);
    }
  });

  it("事件属性与 javascript: URL 报错", () => {
    expect(sanitizeCardHtml('<div onclick="x()">a</div>').ok).toBe(false);
    expect(sanitizeCardHtml('<img src="javascript:alert(1)">').ok).toBe(false);
  });

  it("img src 白名单:站内路径与 data:image 放行,外链/相对路径报错", () => {
    expect(sanitizeCardHtml('<img src="/wp-content/uploads/2026/10/a.png" alt="x">').ok).toBe(true);
    expect(sanitizeCardHtml('<img src="data:image/png;base64,iVBORw0KGgo=">').ok).toBe(true);
    expect(sanitizeCardHtml('<img src="https://evil.com/x.png">').ok).toBe(false);
    expect(sanitizeCardHtml('<img src="local.png">').ok).toBe(false);
    expect(sanitizeCardHtml('<img src="/wp-content/uploads/../etc/passwd">').ok).toBe(false);
  });

  it("img 超 8 张报错", () => {
    const html = Array.from({ length: 9 }, () => '<img src="/wp-content/uploads/a/b.png">').join(
      "",
    );
    const r = sanitizeCardHtml(html);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("8 张");
  });

  it("<style> 放行但 @import/外联 url() 报错", () => {
    expect(sanitizeCardHtml("<style>.a{color:red}</style><p>x</p>").ok).toBe(true);
    const bad = sanitizeCardHtml("<style>@import url(https://f.com/x.css);</style><p>x</p>");
    expect(bad.ok).toBe(false);
    const bad2 = sanitizeCardHtml("<style>.a{background:url(https://evil.com/t.png)}</style>");
    expect(bad2.ok).toBe(false);
  });

  it("无害未知标签解包保文本且不算违规", () => {
    const r = sanitizeCardHtml("<div><custom-tag>保留文字</custom-tag></div>");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toContain("保留文字");
  });

  it("属性白名单:第二遍裁掉白名单外属性(href 等)", () => {
    const r = sanitizeCardHtml('<div class="a" data-x="1" align="left">t</div>');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html).toContain('class="a"');
      expect(r.html).not.toContain("data-x");
      expect(r.html).not.toContain("align");
    }
  });

  it("id 与表格跨列属性保留(渲染宽容化放宽项)", () => {
    const r = sanitizeCardHtml(
      '<div id="hero"><table><tr><td colspan="2" rowspan="1">x</td></tr></table></div>',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html).toContain('id="hero"');
      expect(r.html).toContain('colspan="2"');
      expect(r.html).toContain('rowspan="1"');
    }
  });

  it("模型自带 body 样式后置生效,可覆盖基线(白底等自定义照常渲染)", () => {
    const r = sanitizeCardHtml("<style>body{background:#ffffff;color:#111}</style><p>白底卡</p>");
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bodyCss = r.html.indexOf("background:#ffffff");
      const baseline = r.html.indexOf("background:#0b1220");
      expect(bodyCss).toBeGreaterThan(baseline);
      expect(bodyCss).toBeGreaterThan(-1);
    }
  });

  it("超长 HTML 报错", () => {
    const r = sanitizeCardHtml("x".repeat(400_001));
    expect(r.ok).toBe(false);
  });
});
