/**
 * 封面 prompt 建议契约单测(2026-10-06 M16 验收反馈问题2):JSON 提炼容错、
 * 超长截到 prompt 帽、双空入参边界校验、prompt 双分支(有/无正文取样)。
 */
import { describe, expect, it } from "vitest";

import {
  buildCoverPromptSuggestPrompt,
  COVER_PROMPT_MAX,
  coverPromptInputSchema,
  parseCoverPrompt,
} from "./cover-prompt-suggest";

const GOOD = JSON.stringify({
  prompt: "横版 16:9 科技封面插画:数据中心机房纵深,蓝紫霓虹光路,简洁现代风格,画面无文字与水印",
});

describe("parseCoverPrompt", () => {
  it("合法 JSON → 结构化结果", () => {
    expect(parseCoverPrompt(GOOD)).toEqual({
      ok: true,
      data: {
        prompt:
          "横版 16:9 科技封面插画:数据中心机房纵深,蓝紫霓虹光路,简洁现代风格,画面无文字与水印",
      },
    });
  });

  it("剥代码围栏与前后噪声;字段 trim", () => {
    const raw = `好的:\n\`\`\`json\n{"prompt":" 画面描述 "}\n\`\`\`\n以上。`;
    expect(parseCoverPrompt(raw)).toEqual({ ok: true, data: { prompt: "画面描述" } });
  });

  it(`超长截到 ${COVER_PROMPT_MAX} 字帽救底,不整条判废;空串判不符`, () => {
    const long = parseCoverPrompt(JSON.stringify({ prompt: "画".repeat(900) }));
    expect(long).toEqual({ ok: true, data: { prompt: "画".repeat(COVER_PROMPT_MAX) } });
    expect(parseCoverPrompt(JSON.stringify({ prompt: " " })).ok).toBe(false);
  });

  it("无 JSON / 非对象 / 缺字段 → 错误串,永不 throw", () => {
    expect(parseCoverPrompt("纯文本没有对象").ok).toBe(false);
    expect(parseCoverPrompt("[1,2,3]").ok).toBe(false);
    expect(parseCoverPrompt(JSON.stringify({ wrong: 1 })).ok).toBe(false);
  });
});

describe("coverPromptInputSchema", () => {
  it("title/excerpt 双空可过 schema(路由层拒),tags 超限判废", () => {
    expect(coverPromptInputSchema.safeParse({ title: "", excerpt: "摘要" }).success).toBe(true);
    expect(
      coverPromptInputSchema.safeParse({ title: "t", excerpt: "", tags: Array(9).fill("tag") })
        .success,
    ).toBe(false);
  });
});

describe("buildCoverPromptSuggestPrompt", () => {
  it("有正文:meta + 正文取样双段;无正文:仅 meta", () => {
    const withContent = buildCoverPromptSuggestPrompt({
      title: "标题",
      contentMd: "正文内容",
      excerpt: "摘要",
      tags: ["AI"],
    });
    expect(withContent.user).toContain("正文(可能截断)");
    expect(withContent.user).toContain("正文内容");

    const noContent = buildCoverPromptSuggestPrompt({
      title: "标题",
      contentMd: "   ",
      excerpt: "摘要",
      tags: [],
    });
    expect(noContent.user).not.toContain("正文");
    expect(noContent.user).toContain("标签:(无)");
  });
});
