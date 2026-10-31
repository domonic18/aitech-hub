/**
 * 散点几何单测(M63 v2,纯函数):对齐 stats/chart.test.ts 纪律——任何输入都不得
 * 产出 NaN/Infinity;单调换方向(轴值涨坐标涨、纵轴值高 y 小);缺值剔除计数;
 * 退化域(单点/全等)仍给出可用坐标轴;标签在绘图区内且互不重叠。两套轴配置
 * (模型榜 price×score、HF downloads×likes)共用同一几何,差别只在刻度格式。
 */
import { describe, expect, it } from "vitest";

import {
  SCATTER_LABEL_BUDGET,
  SCATTER_PLOT,
  buildScatterGeometry,
  cnyLabel,
  compactTickLabel,
  estimateTextWidth,
  priceLabel,
  shortenLabel,
  vendorColorMap,
  vendorCounts,
  type ScatterAxisSpec,
  type ScatterDatum,
  type ScatterOptions,
} from "./scatter";

const LOG_PRICE: ScatterAxisSpec = { scale: "log", format: priceLabel };
const LINEAR_SCORE: ScatterAxisSpec = { scale: "linear", format: (v) => String(v) };
const LOG_COUNT: ScatterAxisSpec = { scale: "log", format: compactTickLabel };

const MODEL_OPTS: ScatterOptions = { x: LOG_PRICE, y: LINEAR_SCORE };
const HF_OPTS: ScatterOptions = { x: LOG_COUNT, y: LOG_COUNT, labelOrder: "rank" };

function datum(over: Partial<ScatterDatum> & { key: string }): ScatterDatum {
  return {
    name: over.key,
    vendor: "V",
    x: 5,
    y: 50,
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

const SAMPLE: ScatterDatum[] = [
  datum({ key: "cheap-smart", y: 70, x: 0.5, rank: 1 }),
  datum({ key: "mid", y: 60, x: 5, rank: 2 }),
  datum({ key: "dear-weak", y: 40, x: 60, rank: 3 }),
  datum({ key: "dear-smart", y: 68, x: 40, rank: 4 }),
  datum({ key: "mid2", y: 55, x: 3, rank: 5 }),
];

describe("buildScatterGeometry", () => {
  it("坐标全部落在绘图区内,且无 NaN/Infinity", () => {
    const g = buildScatterGeometry(SAMPLE, MODEL_OPTS);
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

  it("数值越大 x 越靠右;纵轴值越大 y 越靠上(两条轴都单调)", () => {
    const g = buildScatterGeometry(
      [
        datum({ key: "a", x: 1, y: 50 }),
        datum({ key: "b", x: 100, y: 50 }),
        datum({ key: "c", x: 10, y: 30 }),
        datum({ key: "d", x: 10, y: 80 }),
      ],
      MODEL_OPTS,
    );
    const byKey = new Map(g.points.map((p) => [p.key, p]));
    expect(byKey.get("b")!.cx).toBeGreaterThan(byKey.get("a")!.cx);
    expect(byKey.get("d")!.cy).toBeLessThan(byKey.get("c")!.cy);
  });

  it("对数 x 刻度按值升序、位置单调且带轴语义标签", () => {
    const g = buildScatterGeometry(SAMPLE, MODEL_OPTS);
    expect(g.xTicks.length).toBeGreaterThanOrEqual(2);
    const values = g.xTicks.map((t) => t.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    for (const t of g.xTicks) expect(t.label.startsWith("$")).toBe(true);
    const pos = g.xTicks.map((t) => t.pos);
    expect(pos).toEqual([...pos].sort((a, b) => a - b));
  });

  it("双对数轴(HF):两轴刻度都按 1/2/5 档展开,标签用紧凑计数", () => {
    const g = buildScatterGeometry(
      [
        datum({ key: "a", x: 1200, y: 30 }),
        datum({ key: "b", x: 25_000, y: 800 }),
        datum({ key: "c", x: 400_000, y: 4200 }),
        datum({ key: "d", x: 3_000_000, y: 21_000 }),
      ],
      HF_OPTS,
    );
    expect(g.xTicks.length).toBeGreaterThanOrEqual(2);
    expect(g.yTicks.length).toBeGreaterThanOrEqual(2);
    for (const t of [...g.xTicks, ...g.yTicks]) expect(t.label).not.toBe("");
    expect(g.xTicks.map((t) => t.label)).toContain("1M");
    const pos = g.yTicks.map((t) => t.pos);
    // y 轴值升 → 位置降(屏幕坐标)
    expect(pos).toEqual([...pos].sort((a, b) => b - a));
    for (const n of allNumbers(g)) expect(Number.isFinite(n)).toBe(true);
  });

  it("缺值/非法值不计入散点,但计 missingCount", () => {
    const g = buildScatterGeometry(
      [
        datum({ key: "ok", x: 5, y: 60 }),
        datum({ key: "null-x", x: null }),
        datum({ key: "zero-x", x: 0 }),
        datum({ key: "neg-x", x: -3 }),
        datum({ key: "nan-y", x: 5, y: Number.NaN }),
        datum({ key: "null-y", x: 5, y: null }),
      ],
      MODEL_OPTS,
    );
    expect(g.points.map((p) => p.key)).toEqual(["ok"]);
    expect(g.missingCount).toBe(5);
    expect(g.empty).toBe(false);
  });

  it("线性轴允许 0 与负数(只有对数轴才要求 >0)", () => {
    const g = buildScatterGeometry(
      [
        datum({ key: "zero", x: 5, y: 0 }),
        datum({ key: "neg", x: 10, y: -2 }),
        datum({ key: "pos", x: 20, y: 3 }),
      ],
      MODEL_OPTS,
    );
    expect(g.points).toHaveLength(3);
    expect(g.missingCount).toBe(0);
  });

  it("单点:退化域撑开,仍给出 ≥2 个 x 刻度且坐标有界", () => {
    const g = buildScatterGeometry([datum({ key: "only", y: 33, x: 3 })], MODEL_OPTS);
    expect(g.empty).toBe(false);
    expect(g.points).toHaveLength(1);
    expect(g.xTicks.length).toBeGreaterThanOrEqual(2);
    expect(g.yTicks.length).toBeGreaterThanOrEqual(1);
    expect(g.guide).toBeNull();
    for (const n of allNumbers(g)) expect(Number.isFinite(n)).toBe(true);
  });

  it("全等价(同值):不产 NaN,点仍落在绘图区", () => {
    const g = buildScatterGeometry(
      [
        datum({ key: "a", x: 2, y: 50 }),
        datum({ key: "b", x: 2, y: 50 }),
        datum({ key: "c", x: 2, y: 50 }),
      ],
      MODEL_OPTS,
    );
    expect(g.points).toHaveLength(3);
    expect(g.guide).toBeNull(); // 两轴各需 ≥2 个不同值
    for (const n of allNumbers(g)) expect(Number.isFinite(n)).toBe(true);
  });

  it("空输入 → empty,无点无刻度", () => {
    const g = buildScatterGeometry([], MODEL_OPTS);
    expect(g.empty).toBe(true);
    expect(g.points).toEqual([]);
    expect(g.labels).toEqual([]);
    expect(g.missingCount).toBe(0);
  });

  it("标签不超预算,全部落在绘图区内且互不重叠", () => {
    const many: ScatterDatum[] = Array.from({ length: 40 }, (_, i) =>
      datum({
        key: `m${i}`,
        name: `Model-${i}`,
        y: 20 + ((i * 7) % 60),
        x: 0.2 + ((i * 13) % 90) / 4,
        rank: i + 1,
      }),
    );
    const g = buildScatterGeometry(many, MODEL_OPTS);
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

  it("超长名称中段省略并保留尾部(同名 GGUF/量化变体靠尾部区分)", () => {
    const long = "ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-GGUF";
    const g = buildScatterGeometry(
      [
        datum({ key: "long", name: long, x: 1_000_000, y: 500, rank: 1 }),
        datum({ key: "short", name: "Qwen3.8", x: 2_000_000, y: 600, rank: 2 }),
      ],
      HF_OPTS,
    );
    const label = g.labels.find((l) => l.text.includes("…"));
    expect(label).toBeDefined();
    expect(label!.text.length).toBeLessThanOrEqual(24);
    expect(label!.text.endsWith("GGUF")).toBe(true);
  });
  it("样本充足时画中位数十字,样本不足时不画", () => {
    expect(buildScatterGeometry(SAMPLE, MODEL_OPTS).guide).not.toBeNull();
    expect(
      buildScatterGeometry(
        [
          datum({ key: "a", x: 2, y: 50 }),
          datum({ key: "b", x: 4, y: 60 }),
          datum({ key: "c", x: 8, y: 70 }),
        ],
        MODEL_OPTS,
      ).guide,
    ).toBeNull();
  });
});

describe("shortenLabel", () => {
  it("不超预算原样返回", () => {
    expect(shortenLabel("Qwen3.8")).toBe("Qwen3.8");
    expect(shortenLabel("Claude Fable 5.1 (Xhigh)")).toBe("Claude Fable 5.1 (Xhigh)");
  });

  it("带括号:主体 + 首个后缀词(AA 同类项靠 Max/Xhigh/High 区分)", () => {
    expect(shortenLabel("Claude Opus 5.5 (Max, Default Fallback)")).toBe("Claude Opus 5.5 (Max)");
    expect(shortenLabel("Claude Fable 5.1 (Xhigh, Default Fallback)")).toBe(
      "Claude Fable 5.1 (Xhigh)",
    );
  });

  it("主体过长时截主体保后缀,总长 ≤ 预算", () => {
    const long = `${"A".repeat(40)} (Superlongsuffix, extra)`;
    const out = shortenLabel(long);
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out.endsWith(")")).toBe(true);
    expect(out.includes("…")).toBe(true);
  });

  it("不带括号:中段省略保留尾部", () => {
    const out = shortenLabel("ISTA-DASLab/DeepSeek-V4.1-Flash-1017-GSQ-RCO-GGUF");
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out).toContain("…");
    expect(out.endsWith("GGUF")).toBe(true);
  });
});

describe("cnyLabel", () => {
  it("人民币刻度:整数不留尾零,小于 1 留两位,非法值回空串", () => {
    expect(cnyLabel(10)).toBe("¥10");
    expect(cnyLabel(20)).toBe("¥20");
    expect(cnyLabel(0.72)).toBe("¥0.72");
    expect(cnyLabel(Number.NaN)).toBe("");
  });

  it("同一批点换币种只换刻度文本,点位完全不变(对数轴乘常数=平移)", () => {
    const cny = buildScatterGeometry(SAMPLE, MODEL_OPTS);
    const usd = buildScatterGeometry(
      SAMPLE.map((d) => ({ ...d, x: d.x === null ? null : d.x / 7.2 })),
      { ...MODEL_OPTS, x: { scale: "log", format: (v) => priceLabel(v * 7.2) } },
    );
    expect(usd.points.map((p) => [p.cx, p.cy])).toEqual(cny.points.map((p) => [p.cx, p.cy]));
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

describe("标注的厂商覆盖", () => {
  /** 头部厂商堆高分、其余每家一个代表 —— 就是 AA 榜(Anthropic/OpenAI 各近 20 条)的形态 */
  function crowded(): ScatterDatum[] {
    const vendors = Array.from({ length: 14 }, (_, i) => `V${String(i).padStart(2, "0")}`);
    const data: ScatterDatum[] = [];
    vendors.forEach((vendor, i) => {
      const n = i === 0 ? 20 : 1;
      for (let k = 0; k < n; k += 1) {
        data.push(
          datum({
            key: `${vendor}-${String(k)}`,
            name: `${vendor} model ${String(k)}`,
            vendor,
            x: 1 + k * 0.5,
            y: 100 - i * 3 - k * 0.05,
            rank: i * 20 + k + 1,
          }),
        );
      }
    });
    return data;
  }

  it("每厂商至少标一个代表,头部厂商不吃满预算", () => {
    const g = buildScatterGeometry(crowded(), MODEL_OPTS);
    const labelled = new Set(g.labels.map((l) => l.text));
    const vendors = new Set(g.points.map((p) => p.vendor));
    for (const vendor of vendors) {
      const top = g.points
        .filter((p) => p.vendor === vendor)
        .sort((a, b) => b.y - a.y || a.rank - b.rank)[0]!;
      expect(labelled.has(shortenLabel(top.name)), `${String(vendor)} 无代表被标注`).toBe(true);
    }
    expect(g.labels.length).toBeLessThanOrEqual(SCATTER_LABEL_BUDGET);
  });

  it("厂商数超预算时优先标分数高的厂商,且不超预算", () => {
    const data: ScatterDatum[] = [];
    for (let i = 0; i < 30; i += 1) {
      data.push(
        datum({
          key: `m${String(i)}`,
          name: `Model ${String(i)}`,
          vendor: `Vendor${String(i)}`,
          x: 1 + i,
          y: 100 - i,
          rank: i + 1,
        }),
      );
    }
    const g = buildScatterGeometry(data, MODEL_OPTS);
    expect(g.labels.length).toBeLessThanOrEqual(SCATTER_LABEL_BUDGET);
    const labelled = new Set(g.labels.map((l) => l.text));
    expect(labelled.has("Model 0")).toBe(true);
  });
});

describe("vendorCounts", () => {
  it("全厂商计数降序、同数按名称字典序,跳过空厂商", () => {
    const rows = [
      { vendor: "B" },
      { vendor: "A" },
      { vendor: "A" },
      { vendor: "C" },
      { vendor: "C" },
      { vendor: "C" },
      { vendor: "D" },
      { vendor: null },
      { vendor: "" },
    ];
    expect(vendorCounts(rows)).toEqual([
      { vendor: "C", count: 3 },
      { vendor: "A", count: 2 },
      { vendor: "B", count: 1 },
      { vendor: "D", count: 1 },
    ]);
    expect(vendorCounts([])).toEqual([]);
  });
});

describe("estimateTextWidth", () => {
  it("中文字宽 > 同字数 ASCII;空串为 0", () => {
    expect(estimateTextWidth("")).toBe(0);
    expect(estimateTextWidth("深")).toBeGreaterThan(estimateTextWidth("a"));
  });
});
