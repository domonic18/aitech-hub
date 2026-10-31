/**
 * 榜单散点几何(M63 v2,纯函数,RSC 服务端算好、组件只渲染):
 * 通用二维坐标系——两轴各自声明 log/linear 与刻度格式,输入一组 (x, y) 值,
 * 输出绘图区坐标、刻度、中位数十字与避让后的标签。当前两个使用方:
 * - 模型能力与价格:x = 输出价(log),y = 能力分(linear) → 左上角 = 又强又便宜
 * - Hugging Face:x = 下载量(log),y = 点赞数(log) → 右上角 = 又火又被认可
 *
 * 纪律对齐 stats/chart.ts:任何输入(单点/全等/缺值/空)都不得产出
 * NaN/Infinity;退化域人为撑开;标签贪心避让,放不下就不标(点仍在)。
 * 单测锚点:scatter.test.ts。
 */
import { formatCompact } from "./format";

export const SCATTER_W = 960;
export const SCATTER_H = 420;
export const SCATTER_PLOT = { left: 64, top: 24, right: 896, bottom: 368 } as const;

const PAD_L = SCATTER_PLOT.left;
const PAD_R = SCATTER_PLOT.right;
const PAD_T = SCATTER_PLOT.top;
const PAD_B = SCATTER_PLOT.bottom;
const INNER_W = PAD_R - PAD_L;
const INNER_H = PAD_B - PAD_T;

/** 厂商/组织配色(设计令牌 CSS 变量,双主题自适应);数量前 5 占据,其余回落 text-3 */
const PALETTE = [
  "var(--accent)",
  "var(--green)",
  "var(--amber)",
  "var(--red)",
  "var(--blue)",
] as const;
const FALLBACK_COLOR = "var(--text-3)";
/** 未进配色表(厂商过多/无厂商)的点与图例色;组件同源引用 */
export const SCATTER_FALLBACK_COLOR = FALLBACK_COLOR;

/** 标签预算与字号(组件按同值渲染)。
 * 18 = 头部「每厂商至少标一个」的覆盖位(AA 14 家厂商)+ 少量高分冗余:
 * 用户要在图上认出 DeepSeek / Kimi 这类中低位厂商,不能只标分数最高的前 14 个。 */
export const SCATTER_LABEL_BUDGET = 18;
const LABEL_PX = 10.5;
const LABEL_H = 11;

export type AxisScale = "log" | "linear";

export interface ScatterAxisSpec {
  scale: AxisScale;
  /** 刻度文本(值 → 展示串);轴题由组件给,几何不关心语义 */
  format: (v: number) => string;
}

export interface ScatterOptions {
  x: ScatterAxisSpec;
  y: ScatterAxisSpec;
  /** 标注优先级:value=纵轴值大者优先(默认);rank=名次靠前者优先 */
  labelOrder?: "value" | "rank";
}

export interface ScatterDatum {
  key: string;
  name: string;
  vendor: string | null;
  /** 原始 x/y;null/NaN(对数轴另须 >0)即不绘入,计 missingCount */
  x: number | null;
  y: number | null;
  rank: number;
  /** 空心点语义(模型榜=开源权重);未给即实心 */
  hollow?: boolean | null;
}

export interface ScatterPoint {
  key: string;
  name: string;
  vendor: string | null;
  /** 原始轴值(线性轴=原值,对数轴=原值,域值另行换算) */
  x: number;
  y: number;
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
  /** 域(对数轴为 log10 值) */
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
  /** 缺值(未公告价格/缺下载量等)未绘入散点的条数 */
  missingCount: number;
  empty: boolean;
}

/** 厂商计数排序:条数降序、同数按名称字典序(不依赖 locale) */
function byCountThenName(a: [string, number], b: [string, number]): number {
  return a[1] !== b[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/** 确定性配色映射:按条数降序、同数按名称字典序(不依赖 locale) */
export function vendorColorMap(
  rows: Array<{ vendor: string | null }>,
  top = 5,
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.vendor === null || r.vendor === "") continue;
    counts.set(r.vendor, (counts.get(r.vendor) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort(byCountThenName);
  const out = new Map<string, string>();
  sorted.slice(0, top).forEach(([vendor], i) => {
    out.set(vendor, PALETTE[Math.min(i, PALETTE.length - 1)]!);
  });
  return out;
}

/** 图例口径:全部厂商 + 条数(含未进配色表的厂商,画灰点)。
 * 让读者一眼确认「榜上确实有 DeepSeek / Kimi」,而不是只看见前 5 家。 */
export function vendorCounts(
  rows: Array<{ vendor: string | null }>,
): Array<{ vendor: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.vendor === null || r.vendor === "") continue;
    counts.set(r.vendor, (counts.get(r.vendor) ?? 0) + 1);
  }
  return [...counts.entries()].sort(byCountThenName).map(([vendor, count]) => ({ vendor, count }));
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
export function priceLabel(v: number): string {
  const n = v >= 1 ? Number(v.toFixed(2)) : Number(v.toFixed(4));
  return `$${n}`;
}

/** 人民币价格刻度文本:¥10 / ¥20 / ¥50 / ¥0.72(去尾零;刻度由本币域原生生成,不是美元刻度换算) */
export function cnyLabel(v: number): string {
  if (!Number.isFinite(v)) return "";
  const n = v >= 1 ? Number(v.toFixed(1)) : Number(v.toFixed(2));
  return `¥${n}`;
}

/** 计数刻度文本(下载/点赞):1k / 20k / 1.2M;小于 1 保留两位小数 */
export function compactTickLabel(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (v >= 1000) return formatCompact(v);
  if (v >= 1) return String(Math.round(v));
  return String(Number(v.toFixed(2)));
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

/** 线性轴刻度(4–6 条优先,退化域至少 1 条) */
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

function ticksFor(scale: AxisScale, min: number, max: number): number[] {
  return scale === "log" ? logTicks(min, max) : linearTicks(min, max);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** 文本估算宽:CJK 约 10.6px,ASCII 约 6.2px(10.5px 字号);悬停卡在组件侧复用同一口径 */
export function estimateTextWidth(text: string): number {
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

/**
 * 标签文本:超长时缩短,但保留能区分同类项的尾部信息。
 * 同类项常共享前缀——AA 靠括号后缀区分(… (Max/Xhigh/High)),HF 靠量化后缀区分(GGUF/Quantized):
 * - 带括号:主体 + 首个后缀词,"Claude Opus 5.5 (Max, Default Fallback)" → "Claude Opus 5.5 (Max)"
 * - 不带括号:中段省略保留尾部,"ISTA-DASLab/DeepSeek-…-RCO-GGUF"
 */
export function shortenLabel(name: string, max = 24): string {
  if (name.length <= max) return name;
  const open = name.indexOf("(");
  const close = name.lastIndexOf(")");
  if (open > 0 && close > open) {
    const base = name.slice(0, open).trim();
    const tag = name
      .slice(open + 1, close)
      .split(",")[0]!
      .trim();
    if (tag !== "" && base.length + tag.length + 3 <= max) return `${base} (${tag})`;
    const shortTag = tag.length > 10 ? `${tag.slice(0, 9)}…` : tag;
    const room = max - shortTag.length - 4; // 主体可用的字数(含省略号)
    if (shortTag !== "" && room >= 4) return `${base.slice(0, room - 1)}… (${shortTag})`;
  }
  return `${name.slice(0, 13)}…${name.slice(-10)}`;
}

/** 标签排布优先级:先「每个厂商的最高分代表」,再按 labelOrder 补足。
 * 没有这一步,AA 里 Anthropic×19 + OpenAI×18 会把 14 个标签位全部吃掉,
 * 用户在图上看不到 DeepSeek / Kimi / GLM 等中低位厂商(2026-10-31 验收反馈)。 */
function labelPriority(points: ScatterPoint[], order: "value" | "rank"): ScatterPoint[] {
  const cmp =
    order === "rank"
      ? (a: ScatterPoint, b: ScatterPoint): number => a.rank - b.rank
      : (a: ScatterPoint, b: ScatterPoint): number => b.y - a.y || a.rank - b.rank;
  const best = new Map<string, ScatterPoint>();
  for (const p of [...points].sort(cmp)) {
    const vendor = p.vendor ?? "";
    if (vendor === "" || best.has(vendor)) continue;
    best.set(vendor, p);
  }
  const lead = [...best.values()].sort(cmp);
  const seen = new Set(lead.map((p) => p.key));
  return [...lead, ...[...points].sort(cmp).filter((p) => !seen.has(p.key))];
}

/** 标签排布:按 labelPriority 贪心八向避让。
 * 障碍物 = 已放标签 + 全部散点(标签压点会挡数据,宁可少标) */
function placeLabels(points: ScatterPoint[], order: "value" | "rank"): ScatterLabel[] {
  if (points.length === 0) return [];
  const ordered = labelPriority(points, order);
  const labels: ScatterLabel[] = [];
  // 障碍物 = 全部散点(半径 4.5,留 0.5 余量)+ 已放标签
  const boxes: PlacedBox[] = points.map((p) => ({ x: p.cx - 5, y: p.cy - 5, w: 10, h: 10 }));
  for (const p of ordered) {
    if (labels.length >= SCATTER_LABEL_BUDGET) break;
    const text = shortenLabel(p.name);
    const w = estimateTextWidth(text);
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

function isValid(scale: AxisScale, v: number | null): v is number {
  if (v === null || !Number.isFinite(v)) return false;
  return scale === "log" ? v > 0 : true;
}

/** 域计算:8% 内边距;单点/全等时人为撑开;刻度不足 2 根时扩到整档 */
function axisDomain(values: number[], scale: AxisScale): { min: number; max: number } {
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin;
  const pad =
    span > 1e-9
      ? Math.max(span * 0.08, scale === "log" ? 0.08 : 1e-6)
      : scale === "log"
        ? 0.25
        : Math.max(1, Math.abs(rawMin) * 0.05);
  let min = rawMin - pad;
  let max = rawMax + pad;
  if (ticksFor(scale, min, max).length < 2) {
    if (scale === "log") {
      min = Math.floor(rawMin) - 1;
      max = Math.ceil(rawMax) + 1;
    } else {
      const extra = Math.max(1, Math.abs(rawMax) * 0.1);
      min = rawMin - extra;
      max = rawMax + extra;
    }
  }
  return { min, max };
}

export function buildScatterGeometry(data: ScatterDatum[], opts: ScatterOptions): ScatterGeometry {
  const colors = vendorColorMap(data);
  let missingCount = 0;
  const plottable: Array<ScatterDatum & { x: number; y: number }> = [];
  for (const d of data) {
    if (!isValid(opts.x.scale, d.x) || !isValid(opts.y.scale, d.y)) {
      missingCount += 1;
      continue;
    }
    plottable.push({ ...d, x: d.x, y: d.y });
  }

  if (plottable.length === 0) {
    return {
      width: SCATTER_W,
      height: SCATTER_H,
      plot: { ...SCATTER_PLOT },
      xMin: -1,
      xMax: 1,
      yMin: -1,
      yMax: 1,
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

  const project = (scale: AxisScale, v: number): number => (scale === "log" ? Math.log10(v) : v);
  const xDomain = axisDomain(
    plottable.map((p) => project(opts.x.scale, p.x)),
    opts.x.scale,
  );
  const yDomain = axisDomain(
    plottable.map((p) => project(opts.y.scale, p.y)),
    opts.y.scale,
  );
  const xRange = xDomain.max - xDomain.min || 1;
  const yRange = yDomain.max - yDomain.min || 1;

  const px = (v: number): number =>
    round1(
      clamp(PAD_L + ((project(opts.x.scale, v) - xDomain.min) / xRange) * INNER_W, PAD_L, PAD_R),
    );
  const py = (v: number): number =>
    round1(
      clamp(PAD_B - ((project(opts.y.scale, v) - yDomain.min) / yRange) * INNER_H, PAD_T, PAD_B),
    );

  const points: ScatterPoint[] = plottable.map((p) => ({
    key: p.key,
    name: p.name,
    vendor: p.vendor,
    x: p.x,
    y: p.y,
    rank: p.rank,
    color: (p.vendor !== null && colors.get(p.vendor)) || FALLBACK_COLOR,
    hollow: p.hollow === true,
    cx: px(p.x),
    cy: py(p.y),
  }));

  const xTicks: ScatterTick[] = ticksFor(opts.x.scale, xDomain.min, xDomain.max).map((v) => ({
    pos: px(v),
    value: v,
    label: opts.x.format(v),
  }));
  const yTicks: ScatterTick[] = ticksFor(opts.y.scale, yDomain.min, yDomain.max).map((v) => ({
    pos: py(v),
    value: v,
    label: opts.y.format(v),
  }));

  // 中位数十字:样本太少或某轴退化为常量时不画(会切出无意义的「象限」)
  const distinctX = new Set(plottable.map((p) => p.x)).size;
  const distinctY = new Set(plottable.map((p) => p.y)).size;
  const guideOn = points.length >= 4 && distinctX >= 2 && distinctY >= 2;
  const guide = guideOn
    ? { x: px(median(plottable.map((p) => p.x))), y: py(median(plottable.map((p) => p.y))) }
    : null;

  return {
    width: SCATTER_W,
    height: SCATTER_H,
    plot: { ...SCATTER_PLOT },
    xMin: xDomain.min,
    xMax: xDomain.max,
    yMin: yDomain.min,
    yMax: yDomain.max,
    points,
    xTicks,
    yTicks,
    guide,
    quadLabel: guide === null ? null : { x: round1(PAD_L + 8), y: round1(PAD_T + 14) },
    labels: placeLabels(points, opts.labelOrder ?? "value"),
    missingCount,
    empty: false,
  };
}

/** 轴字号等常量供组件引用(与几何同一真相源) */
export const SCATTER_FONT_PX = LABEL_PX;
