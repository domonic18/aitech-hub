/**
 * 文字摘要契约单测(M12 批③):summary ≤120/keywords 3-5 结构钳制、JSON 提炼
 * 容错(围栏/前后噪声)与 prompt 双分支(有/无原文粗提取)。
 */
import { describe, expect, it } from "vitest";

import { buildSummarizePrompt, parseSummarizeResult } from "./summarize-result";

const GOOD = JSON.stringify({ summary: "中心思想", keywords: ["大模型", "开源", "评测"] });

describe("parseSummarizeResult", () => {
  it("合法 JSON → 结构化结果", () => {
    expect(parseSummarizeResult(GOOD)).toEqual({
      ok: true,
      data: { summary: "中心思想", keywords: ["大模型", "开源", "评测"] },
    });
  });

  it("剥代码围栏与前后噪声取平衡片段;summary/keyword trim", () => {
    const raw = `好的,以下是结果:\n\`\`\`json\n{"summary":" 概括 ","keywords":[" a ","b","c"]}\n\`\`\`\n以上。`;
    expect(parseSummarizeResult(raw)).toEqual({
      ok: true,
      data: { summary: "概括", keywords: ["a", "b", "c"] },
    });
  });

  it("keywords 数量越界(2 个/6 个)→ 结构不符", () => {
    expect(parseSummarizeResult(JSON.stringify({ summary: "x", keywords: ["a", "b"] })).ok).toBe(
      false,
    );
    expect(
      parseSummarizeResult(
        JSON.stringify({ summary: "x", keywords: ["a", "b", "c", "d", "e", "f"] }),
      ).ok,
    ).toBe(false);
  });

  it("summary 超 120 字 → 结构不符", () => {
    expect(
      parseSummarizeResult(JSON.stringify({ summary: "长".repeat(121), keywords: ["a", "b", "c"] }))
        .ok,
    ).toBe(false);
  });

  it("无 JSON 对象/坏 JSON → 错误串,永不 throw", () => {
    expect(parseSummarizeResult("完全没有结构化输出").ok).toBe(false);
    expect(parseSummarizeResult("{broken").ok).toBe(false);
  });
});

describe("buildSummarizePrompt", () => {
  it("有原文粗提取 → user 带正文段;否则仅标题+摘要(降级分支 system 提示)", () => {
    const withContent = buildSummarizePrompt({
      title: "标题",
      summary: "摘要",
      content: "正文粗提取",
    });
    expect(withContent.user).toContain("——正文粗提取(可能截断)——\n正文粗提取");
    expect(withContent.system).toContain("JSON");

    const degraded = buildSummarizePrompt({ title: "标题", summary: "摘要", content: null });
    expect(degraded.user).not.toContain("正文粗提取");
    expect(degraded.system).toContain("仅基于标题与摘要");
  });
});
