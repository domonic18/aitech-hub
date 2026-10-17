/**
 * checkCardEmbeds 单测(2026-10-17 验收反馈:模型渲染卡图但正文漏嵌入):
 * 纯自洽校验——只审计「列出的 url 正文必须嵌了」,不规定该有几张卡
 * (呈现策略归指南与自评审);漏嵌报错带可抄写的 markdown 行。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../topics/compose", () => ({}));
vi.mock("../topics/repo", () => ({}));
vi.mock("../media/service", () => ({ uploadMedia: vi.fn() }));
vi.mock("../media/fetch-external", () => ({ fetchExternalImage: vi.fn() }));

import { checkCardEmbeds } from "./topic-draft-tool";

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
});
