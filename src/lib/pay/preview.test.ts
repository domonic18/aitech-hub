/**
 * 预览截断纯函数单测(M21 批③):长度上限、空白断句、代码围栏补闭合
 * (防预览区把后文当代码块渲染泄漏)。
 */
import { describe, expect, it } from "vitest";

import { previewMarkdown } from "@/lib/pay/preview";

describe("previewMarkdown(M21 门禁预览)", () => {
  it("短文原样返回", () => {
    expect(previewMarkdown("短文", 100)).toBe("短文");
  });

  it("超长截断在最后空白处(不截断词中)", () => {
    const md = `${"一".repeat(300)} ${"二".repeat(300)} 尾句`;
    const out = previewMarkdown(md, 400);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith("尾句")).toBe(false); // 400 字内最后空白处断句,尾句不在预览
  });

  it("未闭合代码围栏补闭合(防后文泄漏为代码块)", () => {
    const md = `${"前文".repeat(196)}\n\`\`\`js\nconst secret = "后半段代码";`;
    const out = previewMarkdown(md, 400);
    expect(out.endsWith("```")).toBe(true);
  });

  it("已闭合围栏不再补", () => {
    const md = `${"a".repeat(150)}\n\`\`\`\ncode\n\`\`\`\n${"b".repeat(150)} 泄漏词`;
    const out = previewMarkdown(md, 200);
    expect(out.match(/^```/gm)?.length).toBe(2);
  });
});
