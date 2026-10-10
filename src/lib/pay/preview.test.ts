/**
 * 预览截断纯函数单测(M21 批③):长度上限、空白断句、代码围栏补闭合
 * (防预览区把后文当代码块渲染泄漏)。
 */
import { describe, expect, it } from "vitest";

import { gateNoticeMd, gateNoticeText, previewMarkdown } from "@/lib/pay/preview";

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

describe("gateNotice(GEO 门禁说明,2026-10-09 验收反馈问题2)", () => {
  it("paid/login 文案与链接形态", () => {
    expect(gateNoticeMd("paid", "https://17aitech.com/post/1-a/")).toBe(
      "---\n> 本文为付费内容,以上为预览。全文请访问:https://17aitech.com/post/1-a/(解锁后阅读)",
    );
    expect(gateNoticeMd("login", "https://x/post/1/")).toBe(
      "---\n> 本文为登录可见内容(登录后免费阅读),以上为预览。全文请访问:https://x/post/1/",
    );
    expect(gateNoticeText("paid")).toBe("[付费文章,仅预览]");
    expect(gateNoticeText("login")).toBe("[登录可见,仅预览]");
  });
});
