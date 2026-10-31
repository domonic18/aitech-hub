/**
 * 智能指数散点几何(M63,纯函数,RSC 服务端算好、组件只渲染):
 * x = log10(输出价 USD/1M tokens),y = Artificial Analysis 智能指数。
 * 单调换 → 左上角 = 高分低价 = 「又强又便宜」。
 *
 * 纪律对齐 stats/chart.ts:任何输入(单点/全等/缺价/空)都不得产出
 * NaN/Infinity;退化域人为撑开;标签贪心避让,放不下就不标(点仍在)。
 * 单测锚点:scatter.test.ts。
 */

export const SCATTER_W = 960;
export const SCATTER_H = 420;
export const SCATTER_PLOT = { left: 64, top: 24, right: 896, bottom: 368 } as const;

const PAD_L = SCATTER_PLOT.left;
const PAD_R = SCATTER_PLOT.right;
const PAD_T = SCATTER_PLOT.top;
const PAD_B = SCATTER_PLOT.bottom;
const INNER_W = PAD_R - PAD_L;
const INNER_H = PAD_B - PAD_T;

/** 厂商配色(设计令牌 CSS 变量,双主题自适应);数量前 5 占据,其余回落 text-3 */
const PALETTE = [
  "var(--accent)",
  "var(--green)",
  "var(--amber)",
  "var(--red)",
  "var(--blue)",
] as const;
const FALLBACK_COLOR = "var(--text-3)";

/** 标签预算与字号(组件按同值渲染) */
export const SCATTER_LABEL_BUDGET = 14;
const LABEL_PX = 10.5;
const LABEL_H = 11;

export interface ScatterInput {
  key: string;
  name: string;
  vendor: string | null;
  /** 智能指数(AAII) */
  intelligence: number | null;
  /** 输出价 USD/1M tokens;null/0/负数 = 未公布 */
  outputPrice: number | null;
  openWeights: boolean | null;
  rank: number;
}

export interface ScatterPoint {
  key: string;
  name: string;
  vendor: string | null;
  intelligence: number;
  price: number;
  rank: number;
  color: string;
  hollow: boolean;
  /** 绘图区坐标(已夹在 plot 内) */
  cx: number;
  cy: number;
}

export interface ScatterLabel {
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** 标签离点较远时的引线(点心 → 标签近端);近处不画 */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

export interface ScatterTick {
  /** 轴上的绘图区坐标 */
  pos: number;
  value: number;
  label: string;
}

export interface ScatterGeometry {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  /** log10(价) 域 */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  points: ScatterPoint[];
  xTicks: ScatterTick[];
  yTicks: ScatterTick[];
  /** 中位数十字虚线坐标;不可画(点太少/退化为常量)时 null */
  guide: { x: number; y: number } | null;
  quadLabel: { x: number; y: number } | null;
  labels: ScatterLabel[];
  /** 未公布输出价、未绘入散点的条数 */
  missingCount: number;
  empty: boolean;
}

/** 确定性厂商色映射:按条数降序、同数按名称字典序(不依赖 locale) */
export function vendorColorMap(
  rows: Array<{ vendor: string | null }>,
  top = 5,
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.vendor === null || r.vendor === "") continue;
    counts.set(r.vendor, (counts.get(r.vendor) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) =>
    a[1] !== b[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  const out = new Map<string, string>();
  sorted.slice(0, top).forEach(([vendor], i) => {
    out.set(vendor, PALETTE[Math.min(i, PALETTE.length - 1)]!);
  });
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Number(n.toFixed(1));
}

/** 对数轴刻度:1/2/5 × 10^n 落在域内,超 7 个等比抽到 7(首尾保留) */
function logTicks(min: number, max: number): number[] {
  const lo = Math.floor(min) - 1;
  const hi = Math.ceil(max) + 1;
  const found: number[] = [];
  for (let n = lo; n <= hi; n += 1) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, n);
      const l = Math.log10(v);
      if (l >= min - 1e-9 && l <= max + 1e-9) found.push(v);
    }
  }
  const uniq = [...new Set(found)].sort((a, b) => a - b);
  if (uniq.length <= 7) return uniq;
  const picked: number[] = [];
  const step = (uniq.length - 1) / 6;
  for (let i = 0; i < 6; i += 1) picked.push(uniq[Math.round(i * step)]!);
  picked.push(uniq.at(-1)!);
  return [...new Set(picked)];
}

/** 价格刻度文本:$0.1 / $2 / $10 / $100(去尾零) */
function priceLabel(v: number): string {
  const n = v >= 1 ? Number(v.toFixed(2)) : Number(v.toFixed(4));
  return `$${n}`;
}

/** 最小「好看」步长 ∈ {1,2,2.5,5,10}×10^k */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * base >= raw) return m * base;
  }
  return 10 * base;
}

/** 线性 y 轴刻度(4–6 条优先,退化域至少 1 条) */
function linearTicks(min: number, max: number): number[] {
  const span = max - min;
  const step = niceStep(span / 5);
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + 1e-9 && out.length < 10; v += step) {
    out.push(Number(v.toFixed(4)));
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** 文本估算宽:CJK 约 10.6px,ASCII 约 6.2px(10.5px 字号) */
function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 10.6 : 6.2;
  return w;
}

interface PlacedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 八向 × 三档距离:近处放不下就往远处找(密集簇里标签要躲开一整片点) */
const OFFSETS = (
  [
    { ux: 1, uy: 0, anchor: "start" },
    { ux: -1, uy: 0, anchor: "end" },
    { ux: 0, uy: -1, anchor: "middle" },
    { ux: 0, uy: 1, anchor: "middle" },
    { ux: 1, uy: -1, anchor: "start" },
    { ux: 1, uy: 1, anchor: "start" },
    { ux: -1, uy: -1, anchor: "end" },
    { ux: -1, uy: 1, anchor: "end" },
  ] as const
).flatMap(({ ux, uy, anchor }) =>
  [7, 17, 28].map((d) => ({
    dx: ux === 0 ? 0 : ux * d,
    dy: uy === 0 ? 3 : uy * d + 3,
    anchor,
  })),
);

function boxOf(
  p: ScatterPoint,
  dx: number,
  dy: number,
  anchor: ScatterLabel["anchor"],
  w: number,
): PlacedBox {
  const bx = anchor === "start" ? p.cx + dx : anchor === "end" ? p.cx + dx - w : p.cx + dx - w / 2;
  return { x: bx, y: p.cy + dy - 9, w, h: LABEL_H };
}

function inPlot(b: PlacedBox): boolean {
  return b.x >= PAD_L && b.x + b.w <= PAD_R && b.y >= PAD_T && b.y + b.h <= PAD_B;
}

function overlaps(a: PlacedBox, b: PlacedBox, gap = 2): boolean {
  return !(
    a.x + a.w + gap < b.x ||
    a.x > b.x + b.w + gap ||
    a.y + a.h + gap < b.y ||
    a.y > b.y + b.h + gap
  );
}

/** 标签排布:高分前 10 优先,余量给左上象限;贪心八向避让。
 * 障碍物 = 已放标签 + 全部散点(标签压点会挡数据,宁可少标) */
function placeLabels(points: ScatterPoint[]): ScatterLabel[] {
  if (points.length === 0) return [];
  const byScore = [...points].sort((a, b) => b.intelligence - a.intelligence || a.rank - b.rank);
  const head = byScore.slice(0, 10);
  const rest = byScore.slice(10);
  const ordered = [...head, ...rest];
  const labels: ScatterLabel[] = [];
  // 障碍物 = 全部散点(半径 4.5,留 0.5 余量)+ 已放标签
  const boxes: PlacedBox[] = points.map((p) => ({ x: p.cx - 5, y: p.cy - 5, w: 10, h: 10 }));
  for (const p of ordered) {
    if (labels.length >= SCATTER_LABEL_BUDGET) break;
    const text = p.name.length > 24 ? `${p.name.slice(0, 23)}…` : p.name;
    const w = textWidth(text);
    for (const off of OFFSETS) {
      const box = boxOf(p, off.dx, off.dy, off.anchor, w);
      if (!inPlot(box)) continue;
      if (boxes.some((b) => overlaps(b, box))) continue;
      boxes.push(box);
      const far = Math.abs(off.dx) + Math.abs(off.dy) > 16;
      labels.push({
        text,
        x: round1(p.cx + off.dx),
        y: round1(p.cy + off.dy),
        anchor: off.anchor,
        leader: far
          ? { x1: p.cx, y1: p.cy, x2: round1(p.cx + off.dx), y2: round1(p.cy + off.dy - 3) }
          : null,
      });
      break;
    }
  }
  return labels;
}

export function buildScatterGeometry(inputs: ScatterInput[]): ScatterGeometry {
  const colors = vendorColorMap(inputs);
  let missingCount = 0;
  const plottable: Array<ScatterInput & { intelligence: number; outputPrice: number }> = [];
  for (const it of inputs) {
    const price = it.outputPrice;
    if (
      it.intelligence === null ||
      !Number.isFinite(it.intelligence) ||
      price === null ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      missingCount += 1;
      continue;
    }
    plottable.push({ ...it, intelligence: it.intelligence, outputPrice: price });
  }

  if (plottable.length === 0) {
    return {
      width: SCATTER_W,
      height: SCATTER_H,
      plot: { ...SCATTER_PLOT },
      xMin: -1,
      xMax: 1,
      yMin: 0,
      yMax: 100,
      points: [],
      xTicks: [],
      yTicks: [],
      guide: null,
      quadLabel: null,
      labels: [],
      missingCount,
      empty: true,
    };
  }

  const logs = plottable.map((p) => Math.log10(p.outputPrice));
  const intel = plottable.map((p) => p.intelligence);
  const rawXMin = Math.min(...logs);
  const rawXMax = Math.max(...logs);
  const rawYMin = Math.min(...intel);
  const rawYMax = Math.max(...intel);
  const xSpan = rawXMax - rawXMin;
  const ySpan = rawYMax - rawYMin;
  const xPad = xSpan > 1e-9 ? Math.max(xSpan * 0.08, 0.08) : 0.25;
  const yPad = ySpan > 1e-9 ? Math.max(ySpan * 0.08, 1) : 5;
  let xMin = rawXMin - xPad;
  let xMax = rawXMax + xPad;
  // 价格域过窄时 1/2/5 刻度可能一个都落不进来(单点、同价)→ 撑到整十进位,
  // 保证坐标轴至少有两根刻度,不画空轴
  if (logTicks(xMin, xMax).length < 2) {
    xMin = Math.floor(rawXMin) - 1;
    xMax = Math.ceil(rawXMax) + 1;
  }
  const yMin = rawYMin - yPad;
  const yMax = rawYMax + yPad;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const xAt = (logPrice: number): number =>
    round1(clamp(PAD_L + ((logPrice - xMin) / xRange) * INNER_W, PAD_L, PAD_R));
  const yAt = (v: number): number =>
    round1(clamp(PAD_B - ((v - yMin) / yRange) * INNER_H, PAD_T, PAD_B));

  const points: ScatterPoint[] = plottable.map((p) => ({
    key: p.key,
    name: p.name,
    vendor: p.vendor,
    intelligence: p.intelligence,
    price: p.outputPrice,
    rank: p.rank,
    color: (p.vendor !== null && colors.get(p.vendor)) || FALLBACK_COLOR,
    hollow: p.openWeights === true,
    cx: xAt(Math.log10(p.outputPrice)),
    cy: yAt(p.intelligence),
  }));

  const xTicks: ScatterTick[] = logTicks(xMin, xMax).map((v) => ({
    pos: xAt(Math.log10(v)),
    value: v,
    label: priceLabel(v),
  }));
  const yTicks: ScatterTick[] = linearTicks(yMin, yMax).map((v) => ({
    pos: yAt(v),
    value: v,
    label: String(v),
  }));

  // 中位数十字:样本太少或某轴退化为常量时不画(会切出无意义的「象限」)
  const distinctX = new Set(plottable.map((p) => p.outputPrice)).size;
  const distinctY = new Set(intel).size;
  const guideOn = points.length >= 4 && distinctX >= 2 && distinctY >= 2;
  const medianPrice = guideOn ? median(plottable.map((p) => p.outputPrice)) : null;
  const guide =
    medianPrice === null ? null : { x: xAt(Math.log10(medianPrice)), y: yAt(median(intel)) };

  return {
    width: SCATTER_W,
    height: SCATTER_H,
    plot: { ...SCATTER_PLOT },
    xMin,
    xMax,
    yMin,
    yMax,
    points,
    xTicks,
    yTicks,
    guide,
    quadLabel: guide === null ? null : { x: round1(PAD_L + 8), y: round1(PAD_T + 14) },
    labels: placeLabels(points),
    missingCount,
    empty: false,
  };
}

/** 轴字号等常量供组件引用(与几何同一真相源) */
export const SCATTER_FONT_PX = LABEL_PX;
