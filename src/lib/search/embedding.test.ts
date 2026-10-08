/**
 * embedding 共享层单测:向量序列化维度守卫、markdown 清洗(图片/链接/代码/
 * 装饰符)、三域文本构造(前置权重/截断/空段剔除)。
 */
import { describe, expect, it } from "vitest";

import {
  EMBEDDING_DIMS,
  buildPostEmbedText,
  buildRepoEmbedText,
  buildTelegramEmbedText,
  serializeVector,
  stripMarkdownForEmbed,
} from "./embedding";

describe("serializeVector", () => {
  it("输出 pgvector 文本字面量;维度不符抛错", () => {
    expect(serializeVector(Array(EMBEDDING_DIMS).fill(0.5))).toBe(
      `[${Array(EMBEDDING_DIMS).fill(0.5).join(",")}]`,
    );
    expect(() => serializeVector([0.1, 0.2])).toThrow(/维度不符/);
  });
});

describe("stripMarkdownForEmbed", () => {
  it("剥图片/链接 URL/代码标记,留文字内容;折叠空白", () => {
    const md = [
      "# 标题",
      "看[这篇文章](https://example.com/a)讲向量。",
      "![截图](/wp-content/uploads/x.webp)",
      "```ts",
      "const a = 1;",
      "```",
      "行内 `code()` 与 **加粗**。",
    ].join("\n");
    const out = stripMarkdownForEmbed(md);
    expect(out).not.toContain("http");
    expect(out).not.toContain("![");
    expect(out).not.toContain("```");
    expect(out).toContain("这篇文章");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("code()");
    expect(out).toContain("加粗");
    expect(out).not.toMatch(/\s{2,}/);
  });
});

describe("三域文本构造", () => {
  it("post:标题/摘要前置,正文清洗截断", () => {
    const text = buildPostEmbedText({
      title: "pgvector 混合检索实践",
      excerpt: "零迁移升级检索召回",
      contentMd: `${"# 标记".repeat(10)}\n正文内容`,
    });
    expect(text.startsWith("pgvector 混合检索实践\n")).toBe(true);
    expect(text).toContain("零迁移升级检索召回");
    expect(text).toContain("正文内容");
  });

  it("telegram:AI 解读字段优先于原始 summary;空 title 剔除", () => {
    const text = buildTelegramEmbedText({
      title: null,
      summary: "原始摘要",
      aiSummary: "AI 一句话",
      aiTopic: "模型发布",
    });
    expect(text.split("\n")).toEqual(["模型发布", "AI 一句话", "原始摘要"]);
  });

  it("repo:fullName 打头,README 清洗进尾部", () => {
    const text = buildRepoEmbedText({
      fullName: "pgvector/pgvector",
      description: "vector similarity for Postgres",
      readmeMd: "# pgvector\nOpen-source vector similarity search",
    });
    expect(text.startsWith("pgvector/pgvector\n")).toBe(true);
    expect(text).toContain("vector similarity for Postgres");
    expect(text).toContain("Open-source vector similarity search");
  });
});
