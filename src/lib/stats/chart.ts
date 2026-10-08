/**
 * PV/UV 趋势图几何(纯函数,M5-c):复刻原型 admin-stats renderTrend 的
 * 手写 SVG 几何(DESIGN-SPEC §6 禁图表库),RSC 服务端算好点串、
 * 组件直接渲染;hover 数据提示由 TrendHover client 岛消费 hoverPoints
 * 做最近点吸附(岛内零几何计算)。单测锚点:chart.test.ts。
 */

export interface DayPoint {
  date: string;
  pv: number;
  uv: number;
}

export interface GridLine {
  y: number;
  value: number;
}

export interface XLabel {
  x: number;
  text: string;
}

/** hover 吸附点(viewBox 坐标,tip 与强调点定位用;服务端算好) */
export interface HoverPoint {
  x: number;
  pvY: number;
  uvY: number;
  /** YYYY-MM-DD */
  date: string;
  pv: number;
  uv: number;
}

export interface TrendGeometry {
  /** polyline points 串:"x,y x,y …" */
  pvPoints: string;
  uvPoints: string;
  /** PV 面积渐变 path(基线为图底) */
  areaPath: string;
  gridLines: GridLine[];
  xLabels: XLabel[];
  max: number;
  /** 与折线同源逐点(含抽稀),TrendHover 岛命中测试用 */
  hoverPoints: HoverPoint[];
}

/** 画布与内边距(与原型逐值一致,勿单独改动一侧) */
export const TREND_W = 1040;
export const TREND_H = 300;
/** 绘图区上下界(hover 岛十字线纵向范围) */
export const TREND_TOP = 18;
export const TREND_BASELINE = 270;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 18;
const PAD_B = 30;
const INNER_W = TREND_W - PAD_L - PAD_R;
const INNER_H = TREND_H - PAD_T - PAD_B;

/** 超过该点数做等距抽稀(90 天抽到一半,视觉无差、DOM 减半) */
const DECIMATE_OVER = 60;

function xAt(i: number, len: number): number {
  return PAD_L + (INNER_W * i) / Math.max(len - 1, 1);
}

function yAt(v: number, max: number): number {
  return PAD_T + INNER_H - (INNER_H * v) / max;
}

function decimate<T>(arr: T[]): T[] {
  if (arr.length <= DECIMATE_OVER) return arr;
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += 2) out.push(arr[i]);
  const last = arr[arr.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** 峰值放大 1.15 留头部空隙;全零序列兜底 1,避免除零(NaN 点串) */
function scaleMax(series: DayPoint[]): number {
  const peak = Math.max(0, ...series.map((p) => p.pv));
  return peak === 0 ? 1 : peak * 1.15;
}

export function buildTrendGeometry(series: DayPoint[]): TrendGeometry {
  const pts = decimate(series);
  const max = scaleMax(pts);
  const pointsString = (pick: (p: DayPoint) => number): string =>
    pts.map((p, i) => `${xAt(i, pts.length).toFixed(1)},${yAt(pick(p), max).toFixed(1)}`).join(" ");
  const pvPts = pointsString((p) => p.pv);
  const uvPts = pointsString((p) => p.uv);
  const baseline = PAD_T + INNER_H;
  const areaPath =
    pts.length === 0
      ? ""
      : `M${PAD_L},${baseline.toFixed(1)} L${pvPts.split(" ").join(" L")} L${(TREND_W - PAD_R).toFixed(1)},${baseline.toFixed(1)} Z`;

  // 横向网格 5 条(自上而下),左侧 mono 数值由组件渲染
  const gridLines: GridLine[] = [];
  for (let g = 0; g <= 4; g += 1) {
    gridLines.push({
      y: Number((PAD_T + (INNER_H * g) / 4).toFixed(1)),
      value: Math.round(max * (1 - g / 4)),
    });
  }

  // x 轴日期标签:最多约 7 个(步长 ceil(n/7)),格式 M/D
  const xLabels: XLabel[] = [];
  if (pts.length > 0) {
    const step = Math.ceil(pts.length / 7);
    for (let i = 0; i < pts.length; i += step) {
      const [, m, d] = pts[i]!.date.split("-");
      xLabels.push({ x: Number(xAt(i, pts.length).toFixed(1)), text: `${Number(m)}/${Number(d)}` });
    }
  }

  const hoverPoints: HoverPoint[] = pts.map((p, i) => ({
    x: Number(xAt(i, pts.length).toFixed(1)),
    pvY: Number(yAt(p.pv, max).toFixed(1)),
    uvY: Number(yAt(p.uv, max).toFixed(1)),
    date: p.date,
    pv: p.pv,
    uv: p.uv,
  }));

  return { pvPoints: pvPts, uvPoints: uvPts, areaPath, gridLines, xLabels, max, hoverPoints };
}
