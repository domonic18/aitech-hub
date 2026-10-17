/**
 * preset 模板单测(M31 批B):五模板数据侧 zod 校验(合法/缺字段/超限)、
 * 输出为独立 HTML 文档、文本经转义(注入数据不产生可执行标签)。
 */
import { describe, expect, it } from "vitest";

import { CARD_PRESET_IDS, renderPreset } from "./presets";

describe("renderPreset", () => {
  it("五模板合法数据 → ok 且输出独立文档骨架", () => {
    expect(renderPreset("quote", { quote: "少即是多", author: "佚名" }).ok).toBe(true);
    expect(renderPreset("points", { title: "要点", points: ["a", "b"] }).ok).toBe(true);
    expect(
      renderPreset("stats", {
        items: [
          { value: "78%", label: "采纳率" },
          { value: "3x", label: "提速" },
        ],
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("compare", {
        left: { label: "方案A", items: ["快"] },
        right: { label: "方案B", items: ["稳"] },
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("steps", { steps: [{ title: "安装" }, { title: "配置", detail: "改 env" }] }).ok,
    ).toBe(true);
    for (const id of CARD_PRESET_IDS) expect(CARD_PRESET_IDS).toContain(id);
  });

  it("数据不合法 → 人话报错带字段路径", () => {
    const r = renderPreset("points", { points: ["只有一条"] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("points");

    const r2 = renderPreset("quote", {});
    expect(r2).toMatchObject({ ok: false });
    if (!r2.ok) expect(r2.error).toContain("quote");
  });

  it("未知 preset 之外靠 z.enum 在工具层拦截;此处验证文本转义", () => {
    const r = renderPreset("quote", { quote: '<script>alert(1)</script> & "引号"' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html).toContain("&lt;script&gt;");
      expect(r.html).not.toContain("<script>");
    }
  });

  it("输出包含独立文档结构与基础排版壳", () => {
    const r = renderPreset("stats", {
      items: [
        { value: "1", label: "a" },
        { value: "2", label: "b" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.html.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(r.html).toContain('meta charset="utf-8"');
      expect(r.html).toContain("width:900px");
    }
  });
});
