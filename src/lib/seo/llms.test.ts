/**
 * llms.txt 目录构造回归锚(2026-10-29 M57):/pricing/ 条目曾整行克隆两遍直发
 * 生产(llms.ts 数组里相邻两行同文案),人工 review 与打包校验都没拦住——这里
 * 用「整篇非空行不得重复」的通用不变量兜住同类抄写错误,再定点锚 /pricing/ 单次。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config/site-config", () => ({ getSiteTitle: async () => "一起AI" }));
vi.mock("@/lib/content/posts", () => ({ listAllPostsForSeo: async () => [] }));
vi.mock("@/lib/content/taxonomy", () => ({
  listCategories: async () => [{ name: "AI 工具", slug: "ai-tools" }],
  listTagsWithCount: async () => [{ name: "Claude Code", slug: "claude-code", count: 3 }],
}));
vi.mock("@/lib/github/public", () => ({
  listShowcaseRepos: async () => [
    { fullName: "domonic18/demo", slug: "demo", description: "示例项目" },
  ],
}));
vi.mock("@/lib/pay/preview", () => ({
  gateNoticeMd: () => "",
  gateNoticeText: () => "",
  previewMarkdown: (s: string) => s,
}));
vi.mock("@/lib/seo/site", () => ({
  absoluteUrl: (p: string) => new URL(p, "https://example.com").toString(),
}));

import { buildLlmsIndex } from "./llms";

describe("buildLlmsIndex", () => {
  it("整篇非空行不重复(相邻克隆行直发生产的事故锚)", async () => {
    const md = await buildLlmsIndex();
    const lines = md.split("\n").filter((l) => l.trim() !== "");
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("速查页条目恰好一条", async () => {
    const md = await buildLlmsIndex();
    expect(md.split("](https://example.com/pricing/)")).toHaveLength(2);
  });
});
