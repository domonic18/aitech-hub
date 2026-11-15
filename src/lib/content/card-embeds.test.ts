/**
 * 卡图嵌入自洽校验单测(M72 B1 随函数搬到内容域):card_urls 列出的每张卡必须
 * 已嵌正文;同图重复嵌入拒。
 */
import { describe, expect, it } from "vitest";

import { checkCardEmbeds } from "./card-embeds";

describe("checkCardEmbeds", () => {
  const u1 = "/wp-content/uploads/2026/10/card-a.png";
  const u2 = "/wp-content/uploads/2026/10/card-b.png";

  it("card_urls 为空 → 放行(零卡是否合规归指南与自评审,工具不设策略)", () => {
    expect(checkCardEmbeds("正文没有任何卡片", [])).toEqual({ ok: true });
  });

  it("列了 url 但正文漏嵌 → 人话报错带可抄写 markdown 行", () => {
    const md = `开头\n\n![](${u1})\n\n中间`;
    const r = checkCardEmbeds(md, [u1, u2]);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.error).toContain("1 张");
      expect(r.error).toContain(`![](${u2})`);
      expect(r.error).toContain("独占一行");
    }
  });

  it("全部嵌入 → 放行(嵌在 alt 文本变体中也认)", () => {
    const md = `![](${u1})\n\n正文\n\n![卡片](${u2})`;
    expect(checkCardEmbeds(md, [u1, u2])).toEqual({ ok: true });
  });

  it("同一图片出现两次 → 拒并报出路径与次数(2026-10-17 呈现协调性)", () => {
    const md = `![](${u1})\n\n正文\n\n![卡片](${u2})\n\n![](${u1})`;
    const r = checkCardEmbeds(md, [u1, u2]);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.error).toContain("重复嵌入");
      expect(r.error).toContain(`${u1}(2 次)`);
    }
  });

  it("不同图片各嵌一次 → 放行", () => {
    const md = `![](${u1})\n\n正文\n\n![卡片](${u2})\n\n尾段`;
    expect(checkCardEmbeds(md, [u1, u2])).toEqual({ ok: true });
  });
});
