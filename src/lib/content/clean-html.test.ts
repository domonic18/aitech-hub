import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cleanPostHtml, rewriteBase64Images } from "./clean-html";

const FIXTURES = join(__dirname, "../../../tests/fixtures/wp-content");
const readFixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), "utf8");

describe("cleanPostHtml:注释规则(03 §4)", () => {
  it("Gutenberg 注释删除;<!--more--> 转标准分隔;普通注释删除", () => {
    const { html, report } = cleanPostHtml(
      "<!-- wp:paragraph --><p>前文</p><!-- /wp:paragraph --><!--more--><p>后文</p><!-- 生成的缓存注释 -->",
    );
    expect(html).not.toContain("wp:");
    expect(html).toContain("<!-- more -->");
    expect(html).not.toContain("缓存注释");
    expect(report.gutenbergCommentsRemoved).toBe(2);
    expect(report.moreMarkerKept).toBe(true);
    expect(report.otherCommentsRemoved).toBe(1);
  });

  it("<!--more 阅读全文--> 带自定义文案的变体同样转换", () => {
    const { report } = cleanPostHtml("<p>a</p><!--more 阅读全文--><p>b</p>");
    expect(report.moreMarkerKept).toBe(true);
  });
});

describe("cleanPostHtml:script/style/iframe", () => {
  it("script 与 style 整体删除", () => {
    const { html, report } = cleanPostHtml(
      "<p>a</p><script>alert(1)</script><style>.x{}</style>",
    );
    expect(html).not.toContain("alert");
    expect(report.scriptsRemoved).toBe(1);
    expect(report.stylesRemoved).toBe(1);
  });

  it("bilibili/youtube iframe 保留并剥离多余属性;其他域删除并记报告", () => {
    const { html, report } = cleanPostHtml(
      '<iframe src="https://player.bilibili.com/player.html?bvid=BV1xx" allowfullscreen="1" sandbox="x"></iframe>' +
        '<iframe src="https://evil.example.com/embed"></iframe>',
    );
    expect(html).toContain("player.bilibili.com");
    expect(html).not.toContain("sandbox");
    expect(html).not.toContain("evil.example.com");
    expect(report.iframesKept).toBe(1);
    expect(report.iframesRemoved).toHaveLength(1);
    expect(report.iframesRemoved[0].src).toContain("evil.example.com");
  });
});

describe("cleanPostHtml:短码(实库 0 例,防御)", () => {
  it("[caption] → figure/figcaption", () => {
    const { html, report } = cleanPostHtml(
      '[caption align="center" width="300"]<img src="/wp-content/uploads/2024/04/a.png" alt="x"> 图注文字[/caption]',
    );
    expect(html).toContain("<figure>");
    expect(html).toContain("<figcaption>图注文字</figcaption>");
    expect(report.shortcodesConverted).toContain("caption");
  });

  it("未知成对短码删除;自闭合杂项短码删除;su_* 剥壳", () => {
    const { html, report } = cleanPostHtml(
      "[my_shortcode]内容[/my_shortcode][gallery ids=\"1,2\"][su_box]保留[/su_box]",
    );
    expect(html).not.toContain("my_shortcode");
    expect(html).not.toContain("gallery");
    expect(html).toContain("保留");
    expect(report.shortcodesRemoved.map((s) => s.code)).toEqual([
      "my_shortcode",
      "gallery",
    ]);
  });
});

describe("cleanPostHtml:标签/属性白名单", () => {
  it("白名单外标签剥壳留文本;b/i/s 改名语义等价标签", () => {
    const { html, report } = cleanPostHtml(
      "<div><p><b>加粗</b><i>斜体</i><s>删除</s></p></div>",
    );
    expect(html).not.toContain("<div");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<del>删除</del>");
    expect(report.tagsUnwrapped.div).toBe(1);
  });

  it("a 仅留 href/title;img 剥 srcset 并统一补 loading=lazy;code 仅留 language- class", () => {
    const { html } = cleanPostHtml(
      '<p><a href="https://example.com/a" target="_blank" rel="x" class="c">链</a>' +
        '<img src="/a.png" srcset="/a-300.png 300w" sizes="100vw" alt="图">' +
        '<code class="language-python">x=1</code><code class="foo">y</code></p>',
    );
    expect(html).toContain('<a href="https://example.com/a">');
    expect(html).not.toContain("target=");
    expect(html).toContain('src="/a.png"');
    expect(html).not.toContain("srcset");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('class="language-python"');
    expect(html).not.toContain('class="foo"');
  });

  it("span 仅保留对齐/加粗 style;video 携带 uploads src 剥壳时告警", () => {
    const { html, report } = cleanPostHtml(
      '<p><span style="text-align:center;color:red">居中</span>' +
        '<video src="/wp-content/uploads/2024/04/v.mp4" controls></video></p>',
    );
    expect(html).toContain("text-align:center");
    expect(html).not.toContain("color:red");
    expect(report.warnings.some((w) => w.includes("v.mp4"))).toBe(true);
  });
});

describe("cleanPostHtml:内链相对化(17aitech 三域)", () => {
  it("http/https/www/dev 内链改写为相对路径;外链不动", () => {
    const { html, report } = cleanPostHtml(
      '<p><a href="https://17aitech.com/2-pycharm%e5%ae%89%e8%a3%85/">内</a>' +
        '<img src="http://17aitech.com/wp-content/uploads/2024/04/a.png" alt="">' +
        '<a href="https://dev.17aitech.com/x/?p=1">dev</a>' +
        '<a href="https://baidu.com/x">外</a></p>',
    );
    expect(html).toContain('href="/2-pycharm%e5%ae%89%e8%a3%85/"');
    expect(html).toContain('src="/wp-content/uploads/2024/04/a.png"');
    expect(html).toContain('href="/x/?p=1"');
    expect(html).toContain('href="https://baidu.com/x"');
    expect(report.internalLinksRelativized).toBe(3);
  });
});

describe("rewriteBase64Images / data:URI 策略", () => {
  it("改写回调替换 URL 并返回提取清单(迁移落盘路径)", () => {
    const png1x1 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { html, images } = rewriteBase64Images(
      `<p><img src="data:image/png;base64,${png1x1}" alt=""></p>`,
      (img) => `/wp-content/uploads/data/abc.${img.ext}`,
    );
    expect(html).toContain('src="/wp-content/uploads/data/abc.png"');
    expect(images).toHaveLength(1);
    expect(images[0].ext).toBe("png");
  });

  it("未改写的 data:URI 在清洗时剥离并告警(防御巨串入库)", () => {
    const { html, report } = cleanPostHtml(
      '<p><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""></p>',
    );
    expect(html).not.toContain("data:image");
    expect(report.warnings.some((w) => w.includes("data:URI"))).toBe(true);
  });
});

describe("cleanPostHtml:真实 WP 切片(可重放)", () => {
  it("post-148(Gutenberg+base64,1.3MB):wp: 清零、data: 清零、体积骤减", () => {
    const raw = readFixture("post-148-gutenberg.html");
    const rawB64Count = raw.match(/data:image\//g)?.length ?? 0;
    expect(rawB64Count).toBeGreaterThan(50); // 前置:切片确实含 base64 图

    const { html, report } = cleanPostHtml(raw);
    expect(html).not.toContain("<!-- wp:");
    expect(html).not.toContain("data:image");
    expect(html.length).toBeLessThan(raw.length / 5);
    expect(report.gutenbergCommentsRemoved).toBeGreaterThan(0);
    expect(report.warnings.length).toBeGreaterThan(0); // data:URI 剥离告警
  });

  it("post-2250(第三方 iframe):非白名单 iframe 删除,正文主体保留", () => {
    const raw = readFixture("post-2250-iframe.html");
    const { html, report } = cleanPostHtml(raw);
    expect(html).not.toContain("tensorspace.org");
    expect(report.iframesRemoved.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain("卷积"); // 正文仍在
  });
});
