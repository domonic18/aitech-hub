/**
 * AI 智能指数:冲击分聚合
 *
 * 统计口径:
 * 1) 净冲击 netImpact_t = Σ(impact × 方向符号 × 置信度 × 相关性权重)
 * 2) 7 日滑动平均平滑(消除单日噪声)
 * 3) 冲击分 impactIndex_t = 滚动窗口(默认 180 天)经验分布百分位,取值 0–100,
 *    读作「当天 AI 冲击强度在近半年里的相对位置」,而不是绝对条数
 * 4) MAD 稳健 z 分数识别异常冲击日(阈值 3)
 * 5) 质量门:区分「当天没有 AI 新闻」与「当天冲击很弱」
 */
import { signedImpact, type ScoredNewsItem } from "./score";

export interface ImpactPoint {
  date: string; // YYYY-MM-DD
  itemCount: number;
  netImpact: number | null; // 无数据日为 null(不填 0,避免被读成「AI 停滞」)
  positiveImpact: number;
  negativeImpact: number;
  smoothedImpact: number | null;
  impactIndex: number | null; // 0–100 百分位
  zScore: number | null;
  isAnomaly: boolean;
  quality: "ok" | "thin" | "no_data";
}

export interface ImpactSeriesOptions {
  smoothWindow?: number;
  percentileWindow?: number;
  thinThreshold?: number;
  anomalyZ?: number;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function addDays(day: string, delta: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDay(d);
}

interface Bucket {
  net: number;
  positive: number;
  negative: number;
  count: number;
}

/** ECDF 百分位:窗口内严格小于 x 的占比 + 等值各半 */
function percentileOf(value: number, window: number[]): number {
  if (window.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const v of window) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return (100 * (below + equal * 0.5)) / window.length;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function buildImpactSeries(
  items: ScoredNewsItem[],
  opts: ImpactSeriesOptions = {},
): ImpactPoint[] {
  const smoothWindow = opts.smoothWindow ?? 7;
  const percentileWindow = opts.percentileWindow ?? 180;
  const thinThreshold = opts.thinThreshold ?? 2;
  const anomalyZ = opts.anomalyZ ?? 3;

  const buckets = new Map<string, Bucket>();
  for (const item of items) {
    const d = new Date(item.publishedAt);
    if (Number.isNaN(d.getTime())) continue;
    const day = isoDay(d);
    const bucket = buckets.get(day) ?? { net: 0, positive: 0, negative: 0, count: 0 };
    const signed = signedImpact(item);
    bucket.net += signed;
    if (signed >= 0) bucket.positive += signed;
    else bucket.negative += signed;
    bucket.count += 1;
    buckets.set(day, bucket);
  }

  const days = [...buckets.keys()].sort();
  if (days.length === 0) return [];

  const first = days[0];
  const last = days[days.length - 1];
  const totalDays =
    Math.round((parseDay(last).getTime() - parseDay(first).getTime()) / 86_400_000) + 1;

  const raw: ImpactPoint[] = [];
  for (let i = 0; i < totalDays; i++) {
    const date = addDays(first, i);
    const bucket = buckets.get(date);
    raw.push({
      date,
      itemCount: bucket?.count ?? 0,
      netImpact: bucket ? Number(bucket.net.toFixed(2)) : null,
      positiveImpact: bucket ? Number(bucket.positive.toFixed(2)) : 0,
      negativeImpact: bucket ? Number(bucket.negative.toFixed(2)) : 0,
      smoothedImpact: null,
      impactIndex: null,
      zScore: null,
      isAnomaly: false,
      quality: bucket ? (bucket.count < thinThreshold ? "thin" : "ok") : "no_data",
    });
  }

  // 7 日滑动平均:窗口内取有数据的日均值;当天无条目时沿用窗口内最近可用值,
  // 曲线因此保持连续(quality 字段另行标记「当天无条目」)
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const from = Math.max(0, i - smoothWindow + 1);
    const window = raw
      .slice(from, i + 1)
      .map((x) => x.netImpact)
      .filter((v): v is number => v !== null);
    if (window.length === 0) continue;
    p.smoothedImpact = Number((window.reduce((s, v) => s + v, 0) / window.length).toFixed(2));
  }

  // 滚动窗口百分位 + MAD 稳健 z
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (p.smoothedImpact === null) continue;
    const from = Math.max(0, i - percentileWindow + 1);
    const window = raw
      .slice(from, i + 1)
      .map((x) => x.smoothedImpact)
      .filter((v): v is number => v !== null);
    p.impactIndex = Number(percentileOf(p.smoothedImpact, window).toFixed(1));

    const med = medianOf(window);
    const mad = medianOf(window.map((v) => Math.abs(v - med)));
    const denom = 1.4826 * mad;
    const z = denom > 0 ? (p.smoothedImpact - med) / denom : 0;
    p.zScore = Number(z.toFixed(2));
    p.isAnomaly = z >= anomalyZ;
  }

  return raw;
}

/** 冲击分日环比变化(百分位差) */
export function computeAcceleration(points: ImpactPoint[]): { date: string; value: number }[] {
  return points.slice(1).map((p, i) => ({
    date: p.date,
    value: Number(((p.impactIndex ?? 0) - (points[i].impactIndex ?? 0)).toFixed(2)),
  }));
}
