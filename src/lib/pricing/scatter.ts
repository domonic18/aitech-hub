/**
 * 牌价散点几何(M74 批D):输入价 × 输出价 的对数坐标散点。
 *
 * 纯函数(几何计算独立于渲染,便于单测)——同 /leaderboards 的散点纪律:
 * 手写 SVG、禁图表库(首屏性能 + SEO + 无新依赖)。
 *
 * 口径:
 * - **对数轴**:价格跨度大(0.01 ~ 100+ 元/百万 tokens),线性轴会把低价点全压在
 *   左下角,对数轴才能看出「又便宜又能输出」的分布
 * - **每模型一点**:取该模型**最便宜的一家**报价(输入价小者胜,输入相同比输出)——
 *   这正是用户要问的「这个模型最便宜能多少钱」;不是把每家报价都画上去
 * - **0 价不入图**:完全免费模型价格为 0,取不了对数;计入 `skipped` 并在图下说明
 */
import type { PublicModelRow } from "./public";
import { isTokenPriced } from "./public";
import { buildCompareGroups } from "./compare";

export const PRICE_SCATTER_W = 960;
export const PRICE_SCATTER_H = 420;
export const PRICE_SCATTER_PLOT = { left: 64, top: 24, right: 896, bottom: 368 } as const;

/** 散点上的一个报价(一个模型 × 其最便宜的一家) */
export interface PricePoint {
  id: string;
  modelKey: string;
  displayName: string;
  providerKey: string;
  providerName: string;
  input: number;
  output: number;
  currency: string;
  /** 像素坐标 */
  x: number;
  y: number;
}

export interface PriceAxisTick {
  v: number;
  pos: number;
  label: string;
}

export interface PriceScatterGeometry {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  points: PricePoint[];
  xTicks: PriceAxisTick[];
  yTicks: PriceAxisTick[];
  /** 未入图的报价数(0 价/缺价,取不了对数) */
  skipped: number;
  /** 数据里出现的币种(多币种不可跨轴比) */
  currencies: string[];
}

/** 刻度候选阶梯 */
const TICK_LADDER = [0.01, 0.1, 1, 10, 100, 1000];

/** 紧凑刻度文案 */
function tickLabel(v: number): string {
  if (v >= 1000) return `${v / 1000}k`;
  if (v >= 1) return String(v);
  return String(v);
}

/** 对数映射:值域 [lo, hi] → 像素 [a, b] */
function makeLogScale(lo: number, hi: number, a: number, b: number): (v: number) => number {
  const l = Math.log10(lo);
  const h = Math.log10(hi);
  if (h === l) return () => (a + b) / 2;
  return (v: number): number => a + ((Math.log10(v) - l) / (h - l)) * (b - a);
}

/** 取每个模型最便宜的一家报价(输入价小者胜;输入相同比输出) */
function cheapestPerModel(rows: PublicModelRow[]): Array<{
  modelKey: string;
  displayName: string;
  providerKey: string;
  providerName: string;
  input: number | null;
  output: number | null;
  currency: string;
}> {
  const best = new Map<string, ReturnType<typeof cheapestPerModel>[number]>();
  for (const row of rows) {
    const key = row.modelDictKey ?? row.modelKey;
    const cur = best.get(key);
    const cand = {
      modelKey: key,
      displayName: row.modelDictKey ?? row.modelKey,
      providerKey: row.providerKey ?? row.vendor,
      providerName: row.providerName ?? row.vendor,
      input: row.inputPrice,
      output: row.outputPrice,
      currency: row.currency,
    };
    if (cur === undefined) {
      best.set(key, cand);
      continue;
    }
    const curOk = cur.input !== null || cur.output !== null;
    const candOk = cand.input !== null || cand.output !== null;
    if (!curOk && candOk) {
      best.set(key, cand);
      continue;
    }
    if (!candOk) continue;
    const ci = cur.input;
    const pi = cand.input;
    if (pi !== null && (ci === null || pi < ci)) {
      best.set(key, cand);
      continue;
    }
    if (pi === null && ci !== null) continue;
    if (pi !== null && ci !== null && pi === ci) {
      const co = cur.output;
      const po = cand.output;
      if (po !== null && (co === null || po < co)) best.set(key, cand);
    }
  }
  return [...best.values()];
}

/**
 * 散点几何装配。
 * @param rows 已按前台筛选过滤后的模型行
 */
export function buildPriceScatter(rows: PublicModelRow[]): PriceScatterGeometry {
  // 散点只对 token 计价成立(批G):非 token 行(按张/按秒)两价不是
  // 「输入×输出」语义,进对数轴就是说谎——它们走单价条形图(bars.ts)
  const tokenRows = rows.filter((r) => isTokenPriced(r) && r.priceUnit === "per_1m_tokens");
  const plot = PRICE_SCATTER_PLOT;
  const cheapest = cheapestPerModel(tokenRows);
  const usable = cheapest.filter(
    (c) => c.input !== null && c.input > 0 && c.output !== null && c.output > 0,
  );
  const skipped = cheapest.length - usable.length;
  const currencies = [...new Set(usable.map((c) => c.currency))];

  if (usable.length === 0) {
    return {
      width: PRICE_SCATTER_W,
      height: PRICE_SCATTER_H,
      plot,
      points: [],
      xTicks: [],
      yTicks: [],
      skipped,
      currencies,
    };
  }

  const xs = usable.map((c) => c.input as number);
  const ys = usable.map((c) => c.output as number);
  const xLo = Math.min(...xs);
  const xHi = Math.max(...xs);
  const yLo = Math.min(...ys);
  const yHi = Math.max(...ys);
  // 单值或全等时给一点余量,避免除零与点贴边
  const pad = (lo: number, hi: number): [number, number] =>
    lo === hi ? [lo / 2, hi * 2] : [lo / 10 ** 0.15, hi * 10 ** 0.15];
  const [xMin, xMax] = pad(xLo, xHi);
  const [yMin, yMax] = pad(yLo, yHi);

  const xScale = makeLogScale(xMin, xMax, plot.left, plot.right);
  const yScale = makeLogScale(yMin, yMax, plot.bottom, plot.top);

  const points: PricePoint[] = usable.map((c) => ({
    id: `${c.modelKey}|${c.providerKey}`,
    modelKey: c.modelKey,
    displayName: c.displayName,
    providerKey: c.providerKey,
    providerName: c.providerName,
    input: c.input as number,
    output: c.output as number,
    currency: c.currency,
    x: xScale(c.input as number),
    y: yScale(c.output as number),
  }));

  const ticksIn = (lo: number, hi: number): number[] =>
    TICK_LADDER.filter((v) => v >= lo && v <= hi);

  return {
    width: PRICE_SCATTER_W,
    height: PRICE_SCATTER_H,
    plot,
    points,
    xTicks: ticksIn(xMin, xMax).map((v) => ({ v, pos: xScale(v), label: tickLabel(v) })),
    yTicks: ticksIn(yMin, yMax).map((v) => ({ v, pos: yScale(v), label: tickLabel(v) })),
    skipped,
    currencies,
  };
}

/** 比价矩阵的分组装配(薄封装,便于组件只依赖一个入口) */
export function buildCompareModelGroups(rows: PublicModelRow[]) {
  return buildCompareGroups(rows);
}
