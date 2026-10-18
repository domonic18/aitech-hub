/**
 * 洞察纯函数段(评分卡/覆盖度/异动/动量,单测锚点):零 IO、零 prisma,
 * 供日批机械段与读侧视图共用。原 label.ts 内联段拆出(文件 ≤350 纪律)。
 */
import {
  ANOMALY_MIN_SCORE,
  ANOMALY_RATIO,
  COVERAGE_COVERED,
  COVERAGE_PARTIAL,
  COVERAGE_SATURATION,
  SCORE_GAP_WEIGHT,
  SCORE_HEAT_SATURATION,
  SCORE_HEAT_WEIGHT,
  SCORE_MEDIA_MAX,
  SCORE_MEDIA_WEIGHT,
} from "./constants";

/** 机会评分卡(方案 §2 介质数加权,0-100 三项 40/30/30;coverage=null 视为
 * 未覆盖=空白项满额,促日批尽快回写) */
export function computeOpportunityScore(input: {
  mediaCount: number;
  heatNew: number;
  coverage: number | null;
}): number {
  const mediaBonus =
    (Math.min(Math.max(input.mediaCount, 0), SCORE_MEDIA_MAX) / SCORE_MEDIA_MAX) *
    SCORE_MEDIA_WEIGHT;
  const heatBonus =
    (Math.min(Math.max(input.heatNew, 0), SCORE_HEAT_SATURATION) / SCORE_HEAT_SATURATION) *
    SCORE_HEAT_WEIGHT;
  const gapBonus =
    (input.coverage === null ? 1 : 1 - Math.min(Math.max(input.coverage, 0), 1)) * SCORE_GAP_WEIGHT;
  return Math.round(mediaBonus + heatBonus + gapBonus);
}

/** 覆盖度分(纯函数):最佳相似度 × 命中数饱和因子(0-1,两位小数) */
export function computeCoverageScore(bestDistance: number, matchedCount: number): number {
  const bestSim = Math.min(Math.max(1 - bestDistance, 0), 1);
  const countFactor = Math.min(matchedCount, COVERAGE_SATURATION) / COVERAGE_SATURATION;
  return Math.round(bestSim * countFactor * 100) / 100;
}

/** 覆盖档位(纯函数):covered / partial / blank(空白=选题机会,痛点卡标红) */
export function coverageStateOf(score: number): "covered" | "partial" | "blank" {
  if (score >= COVERAGE_COVERED) return "covered";
  if (score >= COVERAGE_PARTIAL) return "partial";
  return "blank";
}

/** 异动判定(纯函数,方案 §5.5):最新分 ≥ 前 3 日均值 ANOMALY_RATIO 倍且
 * 绝对增量 ≥ ANOMALY_MIN_SCORE;history 升序、末位=最新;前窗无数据=无基线
 * 不告警(防冷启动假告警) */
export function isAnomaly(historyAsc: number[]): boolean {
  if (historyAsc.length < 2) return false;
  const latest = historyAsc[historyAsc.length - 1]!;
  const prev = historyAsc.slice(Math.max(0, historyAsc.length - 1 - 3), historyAsc.length - 1);
  if (prev.length === 0) return false;
  const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
  if (mean <= 0) return false;
  return latest >= ANOMALY_RATIO * mean && latest - mean >= ANOMALY_MIN_SCORE;
}

/** 簇动量(纯函数,批③ 验收三轮:热点雷达改动量榜):近 24h 新增信号 vs
 * 此前累计的读侧方向判定——新晋爆发=24h≥3 且此前≤2;升温=24h≥3 且占比
 * ≥40%;退潮=24h 零新增(且有历史);其余平稳。注意热榜源 refreshMeta 每日
 * 续热会刷新 signal_at,占比口径实偏「仍在榜」语义,作方向徽不作精确度量。 */
export type ClusterMomentum = "burst" | "rising" | "steady" | "cooling";

export function clusterMomentum(sig24h: number, sigBefore: number): ClusterMomentum {
  if (sig24h === 0) return sigBefore > 0 ? "cooling" : "steady";
  if (sig24h >= 3 && sigBefore <= 2) return "burst";
  if (sig24h >= 3 && sig24h / (sig24h + sigBefore) >= 0.4) return "rising";
  return "steady";
}
