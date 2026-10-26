/**
 * save_topic_draft 落稿校验单测(纯函数):checkCardEmbeds(2026-10-17 验收
 * 反馈漏嵌 + 同日呈现协调性反馈补同图重复)与 checkCoverMisuse(封面禁入
 * 正文——文首推荐卡由 finalizeCompose 系统注入,写手把竖版封面当正文配图
 * 小节间乱插的硬闸)。只审计自洽,不设呈现策略。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../topics/compose", () => ({}));
vi.mock("../topics/repo", () => ({}));
vi.mock("../media/service", () => ({ uploadMedia: vi.fn() }));
vi.mock("../media/fetch-external", () => ({ fetchExternalImage: vi.fn() }));

import { checkCardEmbeds, checkCoverMisuse } from "./topic-draft-tool";

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

describe("checkCoverMisuse", () => {
  const cover = "/wp-content/uploads/2026/10/cover.jpg";

  it("正文含封面路径 → 拒,报错指明系统注入与替代图源", () => {
    const r = checkCoverMisuse(`开头\n\n![](${cover})\n\n尾段`, [cover]);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.error).toContain(cover);
      expect(r.error).toContain("文首推荐卡");
      expect(r.error).toContain("render_card");
    }
  });

  it("正文无封面 → 放行;转存失败(null 已滤)不误伤", () => {
    expect(checkCoverMisuse("正文只用卡图", [cover])).toEqual({ ok: true });
    expect(checkCoverMisuse(`![](任意图)`, [])).toEqual({ ok: true });
  });
});
