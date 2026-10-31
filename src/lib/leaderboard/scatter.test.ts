/**
 * 散点几何单测(M63,纯函数):对齐 stats/chart.test.ts 纪律——任何输入都不得
 * 产出 NaN/Infinity;单调换方向(价涨 x 涨、分高 y 小);缺价剔除计数;退化域
 * (单点/全等)仍给出可用坐标轴;标签在绘图区内且互不重叠。
 */
import { describe, expect, it } from "vitest";

import {
  SCATTER_LABEL_BUDGET,
  SCATTER_PLOT,
  buildScatterGeometry,
  vendorColorMap,
  type ScatterInput,
} from "./scatter";

function item(over: Partial<ScatterInput> & { key: string }): ScatterInput {
  return {
    name: over.key,
    vendor: "V",
    intelligence: 50,
    outputPrice: 5,
    openWeights: null,
    rank: 1,
    ...over,
  };
}

function allNumbers(v: unknown): number[] {
  const out: number[] = [];
  const walk = (x: unknown): void => {
    if (typeof x === "number") out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === "object" && x !== null) Object.values(x).forEach(walk);
  };
  walk(v);
  return out;
}

const SAMPLE: ScatterInput[] = [
  item({ key: "cheap-smart", intelligence: 70, outputPrice: 0.5, rank: 1 }),
  item({ key: "mid", intelligence: 60, outputPrice: 5, rank: 2 }),
  item({ key: "dear-weak", intelligence: 40, outputPrice: 60, rank: 3 }),
  item({ key: "dear-smart", intelligence: 68, outputPrice: 40, rank: 4 }),
  item({ key: "mid2", intelligence: 55, outputPrice: 3, rank: 5 }),
];

describe("buildScatterGeometry", () => {
  it("坐标全部落在绘图区内,且无 NaN/Infinity", () => {
    const g = buildScatterGeometry(SAMPLE);
    expect(g.empty).toBe(false);
    expect(g.points).toHaveLength(SAMPLE.length);
    for (const p of g.points) {
      expect(p.cx).toBeGreaterThanOrEqual(SCATTER_PLOT.left);
      expect(p.cx).toBeLessThanOrEqual(SCATTER_PLOT.right);
      expect(p.cy).toBeGreaterThanOrEqual(SCATTER_PLOT.top);
      expect(p.cy).toBeLessThanOrEqual(SCATTER_PLOT.bottom);
    }
    for (const n of allNumbers(g)) expect(Number.isFinite(n)).toBe(true);
  });

  it("价格越高 x 越靠右;智能指数越高 y 越靠上(单调换)", () => {
    const g = buildScatterGeometry([
      item({ key: "a", intelligence: 50, outputPrice: 1 }),
      item({ key: "b", intelligence: 50, outputPrice: 100 }),
      item({ key: "c", intelligence: 30, outputPrice: 10 }),
      item({ key: "d", intelligence: 80, outputPrice: 10 }),
    ]);
    const byKey = new Map(g.points.map((p) => [p.key, p]));
    expect(byKey.get("b")!.cx).toBeGreaterThan(byKey.get("a")!.cx);
    expect(byKey.get("d")!.cy).toBeLessThan(byKey.get("c")!.cy);
  });

  it("x 刻度按价格升序且标签带 $", () => {
    const g = buildScatterGeometry(SAMPLE);
    expect(g.xTicks.length).toBeGreaterThanOrEqual(2);
    const values = g.xTicks.map((t) => t.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    for (const t of g.xTicks) expect(t.label.startsWith("$")).toBe(true);
    // 刻度位置随价格单调(对数轴)
    const pos = g.xTicks.map((t) => t.pos);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  it("缺价/负价/NaN 不计入散点,但计 missingCount", () => {
    const g = buildScatterGeometry([
      item({ key: "ok", outputPrice: 5 }),
      item({ key: "null", outputPrice: null }),
      item({ key: "zero", outputPrice: 0 }),
      item({ key: "neg", outputPrice: -3 }),
      item({ key: "nan", outputPrice: Number.NaN }),
      item({ key: "noIntel", intelligence: null, outputPrice: 5 }),
    ]);
    expect(g.points.map((p) => p.key)).toEqual(["ok"]);
    expect(g.missingCount).toBe(5);
    expect(g.empty).toBe(false);
  });

  it("单点:退化域撑开,仍给出 ≥2 个 x 刻度且坐标有界", () => {
    const g = buildScatterGeometry([item({ key: "only", intelligence: 33, outputPrice: 3 })]);
    expect(g.empty).toBe(false);
    expect(g.points).toHaveLength(1);
    expect(g.xTicks.length).toBeGreaterThanOrEqual(2);
    expect(g.yTicks.length).toBeGreaterThanOrEqual(1);
    expect(g.guide).toBeNull();
    for (const n of allNumbers(g)) expect(Number.isFinite(n)).toBe(true);
  });

  it("全等价(同分同价):不产 NaN,点仍落在绘图区", () => {
    const g = buildScatterGeometry([
      item({ key: "a", intelligence: 50, outputPrice: 2 }),
      item({ key: "b", intelligence: 50, outputPrice: 2 }),
      item({ key: "c", intelligence: 50, outputPrice: 2 }),
    ]);
    expect(g.points).toHaveLength(3);
    expect(g.guide).toBeNull(); // 两轴各需 ≥2 个不同值
    for (const n of allNumbers(g)) expect(Number.isFinite(n)).toBe(true);
  });

  it("空输入 → empty,无点无刻度", () => {
    const g = buildScatterGeometry([]);
    expect(g.empty).toBe(true);
    expect(g.points).toEqual([]);
    expect(g.labels).toEqual([]);
    expect(g.missingCount).toBe(0);
  });

  it("标签不超预算,全部落在绘图区内且互不重叠", () => {
    const many: ScatterInput[] = Array.from({ length: 40 }, (_, i) =>
      item({
        key: `m${i}`,
        name: `Model-${i}`,
        intelligence: 20 + ((i * 7) % 60),
        outputPrice: 0.2 + ((i * 13) % 90) / 4,
        rank: i + 1,
      }),
    );
    const g = buildScatterGeometry(many);
    expect(g.labels.length).toBeLessThanOrEqual(SCATTER_LABEL_BUDGET);
    expect(g.labels.length).toBeGreaterThan(0);
    const boxes = g.labels.map((l) => {
      const w = l.text.length * 6.2;
      const x = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
      return { x, y: l.y - 9, w, h: 11 };
    });
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(SCATTER_PLOT.left - 1);
      expect(b.x + b.w).toBeLessThanOrEqual(SCATTER_PLOT.right + 1);
      expect(b.y).toBeGreaterThanOrEqual(SCATTER_PLOT.top - 1);
      expect(b.y + b.h).toBeLessThanOrEqual(SCATTER_PLOT.bottom + 1);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = !(
          a.x + a.w <= b.x ||
          a.x >= b.x + b.w ||
          a.y + a.h <= b.y ||
          a.y >= b.y + b.h
        );
        expect(overlap).toBe(false);
      }
    }
  });

  it("样本充足时画中位数十字,样本不足时不画", () => {
    expect(buildScatterGeometry(SAMPLE).guide).not.toBeNull();
    expect(
      buildScatterGeometry([
        item({ key: "a", intelligence: 50, outputPrice: 2 }),
        item({ key: "b", intelligence: 60, outputPrice: 4 }),
        item({ key: "c", intelligence: 70, outputPrice: 8 }),
      ]).guide,
    ).toBeNull();
  });
});

describe("vendorColorMap", () => {
  it("按条数降序取前 5,同数按名称字典序(确定性)", () => {
    const rows = [
      { vendor: "B" },
      { vendor: "A" },
      { vendor: "A" },
      { vendor: "C" },
      { vendor: "C" },
      { vendor: "C" },
      { vendor: "D" },
      { vendor: "E" },
      { vendor: "F" },
      { vendor: null },
    ];
    const m = vendorColorMap(rows);
    expect([...m.keys()]).toEqual(["C", "A", "B", "D", "E"]);
    expect(m.size).toBe(5);
    // 同输入同输出
    expect([...vendorColorMap(rows).entries()]).toEqual([...m.entries()]);
  });

  it("未知厂商与空厂商不在映射内(由几何回落 text-3)", () => {
    const m = vendorColorMap([{ vendor: "A" }, { vendor: null }, { vendor: "" }]);
    expect(m.size).toBe(1);
    expect(m.has("A")).toBe(true);
  });
});
