/**
 * 洞察趋势层(M52 批A):簇热度增长分与趋势分级,跨窗对比/新晋榜/动量徽的
 * 数据层。行业对标:Google Trends 的 Rising/Breakout 分级(爆发=翻倍线)+
 * 趋势生命周期四段(Emergence/Growth/Peak/Decline)。
 *
 * 热度口径 = 窗口内在役源信号数(快照 score 是媒体+热度+覆盖的复合分,混入
 * 覆盖度后不反映纯热度变化,故增长分按信号数计)。恒限在役源白名单,双窗
 * 各 TREND_WINDOW_DAYS 天。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { DAY_MS } from "../datetime";
import {
  GROWTH_BREAKOUT,
  GROWTH_DECLINING,
  GROWTH_RISING,
  TREND_NEW_MIN_RECENT,
  TREND_WINDOW_DAYS,
} from "./constants";
import { INSIGHT_SOURCES_ENABLED } from "./ingest";

export type TrendTier = "new" | "breakout" | "rising" | "flat" | "declining";

/** 增长分:近窗与前窗信号数之差,以前窗为基(前窗 0 兜 1 防除零) */
export function growthOf(recent: number, prior: number): number {
  return (recent - prior) / Math.max(prior, 1);
}

/** 趋势分级(纯函数,全分支判据见 constants 阈值注释) */
export function tierOf(recent: number, prior: number): TrendTier {
  if (prior <= 0) return recent >= TREND_NEW_MIN_RECENT ? "new" : "flat";
  const g = growthOf(recent, prior);
  if (g >= GROWTH_BREAKOUT) return "breakout";
  if (g >= GROWTH_RISING) return "rising";
  if (g <= GROWTH_DECLINING) return "declining";
  return "flat";
}

/** 分级中文徽章(🆕🚀📈➡️📉 + 短词;UI 直用) */
export const TREND_TIER_LABELS: Record<TrendTier, string> = {
  new: "🆕 新晋",
  breakout: "🚀 爆发",
  rising: "📈 上升",
  flat: "➡️ 平稳",
  declining: "📉 退潮",
};

export interface ClusterTrendRow {
  clusterId: bigint;
  kind: string; // hot | pain
  label: string | null;
  score: number | null; // 最新机会分(Top 榜排序用)
  recent: number;
  prior: number;
  growth: number;
  tier: TrendTier;
}

/** 活跃簇趋势行:双窗信号计数 + 增长分级(恒限在役源;快照/词云不受影响)。
 * LEFT JOIN 信号过滤条件放 ON(放 WHERE 会把 LEFT 退化成 INNER,无信号簇消失)。 */
export async function listClusterTrends(
  windowDays: number = TREND_WINDOW_DAYS,
): Promise<ClusterTrendRow[]> {
  const now = Date.now();
  const recentStart = new Date(now - windowDays * DAY_MS);
  const priorStart = new Date(now - windowDays * 2 * DAY_MS);
  const enabled = [...INSIGHT_SOURCES_ENABLED];
  const rows = await prisma.$queryRaw<
    {
      id: bigint;
      kind: string;
      label: string | null;
      score: number | null;
      recent: bigint;
      prior: bigint;
    }[]
  >`
    SELECT c.id,
           c.kind,
           c.label,
           c.score,
           count(s.id) FILTER (WHERE s.signal_at >= ${recentStart}) AS recent,
           count(s.id) FILTER (WHERE s.signal_at <  ${recentStart}) AS prior
      FROM insight_cluster c
      LEFT JOIN insight_cluster_member m ON m.cluster_id = c.id
      LEFT JOIN insight_signal s ON s.id = m.signal_id
       AND s.signal_at >= ${priorStart}
       AND s.source IN (${Prisma.join(enabled)})
     WHERE c.status = 'active'
     GROUP BY c.id, c.kind, c.label, c.score
     ORDER BY c.score DESC NULLS LAST`;
  return rows.map((r) => {
    const recent = Number(r.recent);
    const prior = Number(r.prior);
    return {
      clusterId: r.id,
      kind: r.kind,
      label: r.label,
      score: r.score,
      recent,
      prior,
      growth: growthOf(recent, prior),
      tier: tierOf(recent, prior),
    };
  });
}
