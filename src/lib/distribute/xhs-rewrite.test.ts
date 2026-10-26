/**
 * 小红书改写契约单测(M49 批X2):标题/正文/话题超限拦截与归一(# 剥除、
 * 数量截断)——LLM 输出的最后一道闸,契约失败即 chatJsonTask 重试。
 */
import { describe, expect, it } from "vitest";

import { parseXhsDraft } from "./xhs-rewrite";

function draftOf(over: { title?: string; content?: string; tags?: string[] }): string {
  return JSON.stringify({
    title: "标题",
    content: "正文".repeat(100),
    tags: ["AI", "编程", "效率"],
    ...over,
  });
}

describe("parseXhsDraft 契约(M49 批X2)", () => {
  it("合规草稿放行,tags 剥 # 前缀", () => {
    const r = parseXhsDraft(
      draftOf({ title: "Claude 指南🚀", tags: ["#AI", "编程", "#效率", "职场", "工具", " extra"] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.tags).toEqual(["AI", "编程", "效率", "职场", "工具", "extra"]);
  });

  it("标题超 20 字打回", () => {
    const r = parseXhsDraft(draftOf({ title: "一".repeat(21) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("标题");
  });

  it("正文不足 100 字打回", () => {
    const r = parseXhsDraft(draftOf({ content: "太短" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("正文");
  });

  it("正文超 1000 字打回", () => {
    const r = parseXhsDraft(draftOf({ content: "长".repeat(1001) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("正文");
  });

  it("话题不足 3 个打回;非字符串剔除", () => {
    const r = parseXhsDraft(draftOf({ tags: ["AI", 42 as unknown as string] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("话题");
  });

  it("非 JSON 输出打回", () => {
    expect(parseXhsDraft("这不是 JSON").ok).toBe(false);
  });
});
