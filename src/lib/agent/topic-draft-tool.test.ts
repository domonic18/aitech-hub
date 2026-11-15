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

import { checkCoverMisuse } from "./topic-draft-tool";

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
