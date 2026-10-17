/**
 * preset 模板单测(M31 批B 建,M36 批② 扩至七卡型,M38 扩至 11 卡型):
 * 数据侧 zod 校验(合法/缺字段/超限/引用越界)、输出为独立 HTML 文档、
 * 文本经转义(注入数据不产生可执行标签)。
 */
import { describe, expect, it } from "vitest";

import { renderPreset } from "./presets";

describe("renderPreset", () => {
  it("11 模板合法数据 → ok 且输出独立文档骨架", () => {
    expect(renderPreset("quote", { quote: "少即是多", author: "佚名" }).ok).toBe(true);
    expect(
      renderPreset("points", {
        title: "要点",
        points: [{ text: "切块重叠 64", icon: "🧩" }, { text: "召回率 +23%" }],
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("stats", {
        items: [
          { value: "78%", label: "采纳率", delta: "+12%" },
          { value: "3x", label: "提速" },
        ],
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("bars", {
        title: "吞吐对比",
        unit: "tokens/s",
        items: [
          { label: "模型A", pct: 100, value: "120" },
          { label: "模型B", pct: 72, value: "86" },
        ],
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("ledger", {
        title: "环境速览",
        rows: [
          { k: "模型", v: "Qwen3-4B" },
          { k: "量化", v: "INT4" },
          { k: "内存", v: "3.2GB" },
        ],
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("compare", {
        left: { label: "方案A", items: ["快"] },
        right: { label: "方案B", items: ["稳"] },
        verdict: "看场景",
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("steps", { steps: [{ title: "安装" }, { title: "配置", detail: "改 env" }] }).ok,
    ).toBe(true);
    expect(
      renderPreset("timeline", {
        title: "进化史",
        events: [
          { time: "2020", text: "起点" },
          { time: "2026", text: "百万级" },
        ],
        summary: "越来越长",
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("matrix", {
        title: "端侧芯片盘点",
        cells: [
          { name: "NPU A", desc: "算力 10TOPS", icon: "⚡" },
          { name: "NPU B", desc: "算力 8TOPS" },
        ],
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("photo", {
        src: "/wp-content/uploads/2026/10/demo.jpg",
        caption: "实测环境",
      }).ok,
    ).toBe(true);
    expect(
      renderPreset("flow", {
        title: "Agent 全流程",
        lanes: [{ name: "用户" }, { name: "Agent" }],
        phases: [{ name: "接收" }, { name: "执行" }],
        steps: [
          { text: "提任务", lane: 0, phase: 0 },
          { text: "规划", lane: 1, phase: 0 },
          { text: "执行", lane: 1, phase: 1 },
        ],
        summary: "两阶段闭环",
      }).ok,
    ).toBe(true);
  });

  it("flow 步骤引用越界(lane/phase 下标超范围)→ 人话报错指出序号", () => {
    const r = renderPreset("flow", {
      title: "流程",
      lanes: [{ name: "A" }, { name: "B" }],
      phases: [{ name: "P1" }, { name: "P2" }],
      steps: [
        { text: "s1", lane: 0, phase: 0 },
        { text: "s2", lane: 5, phase: 0 },
        { text: "s3", lane: 1, phase: 9 },
      ],
    });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.error).toContain("steps.1.lane");
      expect(r.error).toContain("泳道序号 5 超出范围");
    }
    // 首个 issue 是 lane 越界;修掉后应再暴露 phase 越界
    const r2 = renderPreset("flow", {
      title: "流程",
      lanes: [{ name: "A" }, { name: "B" }],
      phases: [{ name: "P1" }, { name: "P2" }],
      steps: [
        { text: "s1", lane: 0, phase: 0 },
        { text: "s2", lane: 1, phase: 1 },
        { text: "s3", lane: 0, phase: 9 },
      ],
    });
    expect(r2).toMatchObject({ ok: false });
    if (!r2.ok) {
      expect(r2.error).toContain("steps.2.phase");
      expect(r2.error).toContain("阶段序号 9 超出范围");
    }
  });

  it("M38 新卡型边界:bars pct 超 1~100、photo 非站内路径 → 人话报错", () => {
    const bars = renderPreset("bars", {
      items: [
        { label: "A", pct: 120, value: "9" },
        { label: "B", pct: 30, value: "3" },
      ],
    });
    expect(bars).toMatchObject({ ok: false });
    if (!bars.ok) expect(bars.error).toContain("items.0.pct");

    const photo = renderPreset("photo", { src: "https://cdn.example.com/x.jpg" });
    expect(photo).toMatchObject({ ok: false });
    if (!photo.ok) expect(photo.error).toContain("src");
  });

  it("数据不合法 → 人话报错带字段路径", () => {
    const r = renderPreset("points", { points: [{ text: "只有一条" }] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("points");

    const r2 = renderPreset("quote", {});
    expect(r2).toMatchObject({ ok: false });
    if (!r2.ok) expect(r2.error).toContain("quote");
  });

  it("类型漂移报错 → 中文说明 + 直接传数组的修正示例(弱模型自纠)", () => {
    const r = renderPreset("ledger", { rows: { k: "a", v: "b" } });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) {
      expect(r.error).toContain("rows 应为数组,收到了其他类型");
      expect(r.error).toContain("直接传 JSON 数组");
      expect(r.error).toContain('"rows":[{"k":"键","v":"值"}]');
      expect(r.error).not.toContain("expected array");
    }
  });

  it("条数不足报错 → 中文条数口径", () => {
    const r = renderPreset("steps", { steps: [{ title: "只有一步" }] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("steps 至少 2 条");
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
