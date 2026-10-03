import { describe, expect, it } from "vitest";

import { TREND_H, TREND_W, buildTrendGeometry } from "./chart";

function seriesOf(n: number, pv = 100, uv = 50): { date: string; pv: number; uv: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-09-${String((i % 30) + 1).padStart(2, "0")}`,
    pv: pv + i,
    uv: uv + i,
  }));
}

describe("buildTrendGeometry(原型 admin-stats 几何)", () => {
  it("7 天序列:点串长度、峰值 1.15 倍留白", () => {
    const g = buildTrendGeometry(seriesOf(7, 1000, 500));
    expect(g.pvPoints.split(" ")).toHaveLength(7);
    expect(g.uvPoints.split(" ")).toHaveLength(7);
    expect(g.max).toBeCloseTo(1006 * 1.15, 5);
    // 面积路径闭合到画布左右内边距与基线(基线 = H - PAD_B = 270)
    expect(g.areaPath).toMatch(/^M52,270\.0 L/);
    expect(g.areaPath.endsWith("L1024.0,270.0 Z")).toBe(true);
  });

  it("网格 5 条且顶端值≈max,底端值 0;x 标签 ≤7 个且为 M/D 形态", () => {
    const g = buildTrendGeometry(seriesOf(30));
    expect(g.gridLines).toHaveLength(5);
    expect(g.gridLines[0]!.value).toBe(Math.round(g.max));
    expect(g.gridLines[4]!.value).toBe(0);
    expect(g.gridLines[4]!.y).toBeCloseTo(TREND_H - 30, 1);
    expect(g.xLabels.length).toBeLessThanOrEqual(7);
    expect(g.xLabels[0]!.text).toMatch(/^\d{1,2}\/\d{1,2}$/);
    expect(g.xLabels.every((l) => l.x >= 52 && l.x <= TREND_W - 16)).toBe(true);
  });

  it("90 天序列抽稀到约一半(>60 才抽,首尾保留)", () => {
    const g = buildTrendGeometry(seriesOf(90));
    expect(g.pvPoints.split(" ").length).toBe(46);
    const g60 = buildTrendGeometry(seriesOf(60));
    expect(g60.pvPoints.split(" ").length).toBe(60); // 阈值内不抽
  });

  it("全零与空序列不产生 NaN/Infinity", () => {
    const zero = buildTrendGeometry(seriesOf(7).map(() => ({ date: "2026-10-01", pv: 0, uv: 0 })));
    expect(zero.max).toBe(1);
    expect(zero.pvPoints).not.toMatch(/NaN|Infinity/);
    const empty = buildTrendGeometry([]);
    expect(empty.pvPoints).toBe("");
    expect(empty.areaPath).toBe("");
    expect(empty.xLabels).toEqual([]);
    expect(empty.gridLines[0]!.value).toBe(1);
  });

  it("单点序列不除零(落左缘,y 为基线上方按值缩放)", () => {
    const g = buildTrendGeometry([{ date: "2026-10-01", pv: 500, uv: 250 }]);
    expect(g.pvPoints.split(" ")).toHaveLength(1);
    expect(g.pvPoints).not.toMatch(/NaN|Infinity/);
  });
});
