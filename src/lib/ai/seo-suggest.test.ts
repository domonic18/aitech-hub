/**
 * SEO 自动补全契约单测(2026-10-06 验收反馈问题7):JSON 提炼容错(围栏/噪声)、
 * 超长截到 DB 列帽救底、双空入参边界校验、prompt 双分支(有/无正文取样)。
 */
import { describe, expect, it } from "vitest";

import { buildSeoSuggestPrompt, parseSeoSuggest, seoSuggestInputSchema } from "./seo-suggest";

const GOOD = JSON.stringify({
  seoTitle: "Claude Code 实战:把终端变成 AI 工作台",
  seoDescription: "从安装到工作流,一文讲清如何用 Claude Code 提升日常编码效率。",
});

describe("parseSeoSuggest", () => {
  it("合法 JSON → 结构化结果", () => {
    expect(parseSeoSuggest(GOOD)).toEqual({
      ok: true,
      data: {
        seoTitle: "Claude Code 实战:把终端变成 AI 工作台",
        seoDescription: "从安装到工作流,一文讲清如何用 Claude Code 提升日常编码效率。",
      },
    });
  });

  it("剥代码围栏与前后噪声;字段 trim", () => {
    const raw = `好的:\n\`\`\`json\n{"seoTitle":" 标题 ","seoDescription":" 描述 "}\n\`\`\`\n以上。`;
    expect(parseSeoSuggest(raw)).toEqual({
      ok: true,
      data: { seoTitle: "标题", seoDescription: "描述" },
    });
  });

  it("超长截到 DB 列帽(255/500)救底,不整条判废;空串判不符", () => {
    const long = parseSeoSuggest(
      JSON.stringify({ seoTitle: "标".repeat(300), seoDescription: "描".repeat(600) }),
    );
    expect(long).toEqual({
      ok: true,
      data: { seoTitle: "标".repeat(255), seoDescription: "描".repeat(500) },
    });
    expect(parseSeoSuggest(JSON.stringify({ seoTitle: "", seoDescription: "有" })).ok).toBe(false);
  });

  it("无 JSON/坏 JSON → ok:false 带错误串", () => {
    expect(parseSeoSuggest("没有任何结构化内容").ok).toBe(false);
    expect(parseSeoSuggest('{"seoTitle": "截断').ok).toBe(false);
  });
});

describe("seoSuggestInputSchema", () => {
  it("全缺省 → 各字段默认空值(正文可选,路由再卡双空)", () => {
    expect(seoSuggestInputSchema.parse({})).toEqual({
      title: "",
      contentMd: "",
      excerpt: "",
      tags: [],
      categorySlug: "",
    });
  });

  it("标签超量(>5)→ 拒收", () => {
    expect(seoSuggestInputSchema.safeParse({ tags: ["a", "b", "c", "d", "e", "f"] }).success).toBe(
      false,
    );
  });
});

describe("buildSeoSuggestPrompt", () => {
  it("有正文 → user 含正文取样段(截 4000 字)", () => {
    const { user } = buildSeoSuggestPrompt({
      title: "标题",
      contentMd: "正".repeat(5000),
      excerpt: "摘要",
      tags: ["标签一"],
      categorySlug: "ai-news",
    });
    expect(user).toContain("——正文(可能截断)——");
    expect(user).toContain("正".repeat(4000));
    expect(user).not.toContain("正".repeat(4001));
    expect(user).toContain("分类:ai-news");
  });

  it("无正文 → 仅 meta 分支,system 明示仅基于字段", () => {
    const { system, user } = buildSeoSuggestPrompt({
      title: "标题",
      contentMd: "   ",
      excerpt: "",
      tags: [],
      categorySlug: "",
    });
    expect(user).not.toContain("——正文");
    expect(system).toContain("仅基于标题");
  });
});
