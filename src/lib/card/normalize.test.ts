/**
 * 归一层单测:漂移形态收编(实证 fixture)+ 良数透传不变形 + 与 renderPreset
 * 串联(漂移数据经归一后校验通过)。归一是否收编错判的回归锚=checkpoint
 * 取证的 ledger rows 漂移四形态(单键包裹/字符串化 JSON/双重嵌套/二元数组行,
 * 2026-10-18)。
 */
import { describe, expect, it } from "vitest";

import { normalizePresetData } from "./normalize";
import { renderPreset } from "./presets";

const GOOD_ROWS = [
  { k: "上下文", v: "200k" },
  { k: "模态", v: "文本" },
  { k: "开源", v: "是" },
];

describe("normalizePresetData", () => {
  it("实证漂移形态 {item:{item:[…]}} → 还原为数组(checkpoint 取证形态)", () => {
    const drifted = {
      title: "四环节:把 PPT 当项目做",
      rows: {
        item: {
          item: [
            { k: "① 功能设计", v: "先答五个问题" },
            { k: "② 版式设计", v: "三选一预设风格" },
            { k: "③ 内容生成", v: "交给专家" },
            { k: "④ 测试优化", v: "人工查看" },
          ],
        },
      },
    };
    const r = normalizePresetData(drifted);
    expect(r.normalized).toBe(true);
    expect(Array.isArray((r.data as { rows: unknown[] }).rows)).toBe(true);
  });

  it("单层包裹 {item:[…]} → 还原为数组", () => {
    const r = normalizePresetData({ points: { item: [{ text: "a" }, { text: "b" }] } });
    expect(r.normalized).toBe(true);
    expect((r.data as { points: unknown[] }).points).toEqual([{ text: "a" }, { text: "b" }]);
  });

  it("链终非数组({item:{a:1}})不收编,原样透传", () => {
    const drifted = { rows: { item: { k: "a", v: "b" } } };
    const r = normalizePresetData(drifted);
    expect(r.normalized).toBe(false);
    expect(r.data).toBe(drifted);
  });

  it("多键对象({a:1,item:2})不收编——只认单键 item", () => {
    const drifted = { rows: { a: 1, item: [{ k: "x", v: "y" }] } };
    const r = normalizePresetData(drifted);
    expect(r.normalized).toBe(false);
    expect(r.data).toBe(drifted);
  });

  it("字符串化 JSON(checkpoint 取证形态)→ 解析并还原为数组", () => {
    const r = normalizePresetData({ rows: JSON.stringify(GOOD_ROWS) });
    expect(r.normalized).toBe(true);
    expect((r.data as { rows: unknown[] }).rows).toEqual(GOOD_ROWS);
  });

  it('字符串化双重嵌套 "[[{…}]]"(自纠越修越歪实证)→ 剥壳还原', () => {
    const r = normalizePresetData({ rows: JSON.stringify([GOOD_ROWS]) });
    expect(r.normalized).toBe(true);
    expect((r.data as { rows: unknown[] }).rows).toEqual(GOOD_ROWS);
  });

  it('二元数组行 [["键","值"],…] → {k,v} 对象数组', () => {
    const r = normalizePresetData({
      rows: [
        ["上下文", "200k"],
        ["模态", "文本"],
        ["开源", "是"],
      ],
    });
    expect(r.normalized).toBe(true);
    expect((r.data as { rows: unknown[] }).rows).toEqual(GOOD_ROWS);
  });

  it("以 [ 开头的普通文案不收编(非 JSON 字符串透传)", () => {
    const good = { quote: "[2026 新进展] 从这里说起" };
    const r = normalizePresetData(good);
    expect(r.normalized).toBe(false);
    expect(r.data).toBe(good);
  });

  it("深层下钻:对象值内的字符串化与数组内剥壳一并收编", () => {
    const drifted = {
      left: { label: "A", items: JSON.stringify(["x", "y"]) },
      rows: [GOOD_ROWS], // 单元素外层 → 剥壳还原
    };
    const r = normalizePresetData(drifted);
    expect(r.normalized).toBe(true);
    const d = r.data as { left: { items: string[] }; rows: unknown[] };
    expect(d.left.items).toEqual(["x", "y"]);
    expect(d.rows).toEqual(GOOD_ROWS);
  });

  it("良数透传:返回原引用且 normalized=false(零漂移可判)", () => {
    const good = {
      title: "t",
      rows: [
        { k: "a", v: "b" },
        { k: "c", v: "d" },
        { k: "e", v: "f" },
      ],
    };
    const r = normalizePresetData(good);
    expect(r.normalized).toBe(false);
    expect(r.data).toBe(good);
  });

  it("深层下钻:嵌套字段与数组元素内的包裹一并展开", () => {
    const drifted = {
      left: { label: "A", items: { item: ["x", "y"] } },
      rows: [{ k: "k", v: { item: ["z"] } }],
    };
    const r = normalizePresetData(drifted);
    expect(r.normalized).toBe(true);
    const d = r.data as { left: { items: string[] }; rows: { v: string[] }[] };
    expect(d.left.items).toEqual(["x", "y"]);
    expect(d.rows[0].v).toEqual(["z"]);
  });

  it("串联 renderPreset:四种漂移形态台账数据经归一后均渲染成功", () => {
    const shapes: unknown[] = [
      { item: { item: GOOD_ROWS } },
      JSON.stringify(GOOD_ROWS),
      JSON.stringify([GOOD_ROWS]),
      [
        ["上下文", "200k"],
        ["模态", "文本"],
        ["开源", "是"],
      ],
    ];
    for (const rows of shapes) {
      const n = normalizePresetData({ title: "规格速览", rows });
      const r = renderPreset("ledger", n.data);
      expect(r.ok).toBe(true);
    }
  });
});
