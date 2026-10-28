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
import { MATRIX_MIN_MEMBERS } from "./constants";
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
  /** 成员首条信号归一文本前 24 字(未打标簇的可读占位,待打标不再裸奔) */
  sample: string | null;
  recent: number;
  prior: number;
  growth: number;
  tier: TrendTier;
}

/** 活跃簇趋势行:双窗信号计数 + 增长分级(恒限在役源;快照/词云不受影响)。
 * LEFT JOIN 信号过滤条件放 ON(放 WHERE 会把 LEFT 退化成 INNER,无信号簇消失)。
 * domain(M54 批C):领域视图过滤(undefined=全量)——簇已同域分桶,簇侧
 * WHERE 即全行语义域,JOIN 信号侧不需重复过滤 */
export async function listClusterTrends(
  windowDays: number = TREND_WINDOW_DAYS,
  domain?: string,
): Promise<ClusterTrendRow[]> {
  const now = Date.now();
  const recentStart = new Date(now - windowDays * DAY_MS);
  const priorStart = new Date(now - windowDays * 2 * DAY_MS);
  const enabled = [...INSIGHT_SOURCES_ENABLED];
  const domainSql = domain === undefined ? Prisma.empty : Prisma.sql` AND c.domain = ${domain}`;
  const rows = await prisma.$queryRaw<
    {
      id: bigint;
      kind: string;
      label: string | null;
      score: number | null;
      sample: string | null;
      recent: bigint;
      prior: bigint;
    }[]
  >`
    SELECT c.id,
           c.kind,
           c.label,
           c.score,
           count(s.id) FILTER (WHERE s.signal_at >= ${recentStart}) AS recent,
           count(s.id) FILTER (WHERE s.signal_at <  ${recentStart}) AS prior,
           (SELECT left(s2.normalized_text, 24)
              FROM insight_cluster_member m2
              JOIN insight_signal s2 ON s2.id = m2.signal_id
             WHERE m2.cluster_id = c.id
             ORDER BY m2.id
             LIMIT 1) AS sample
      FROM insight_cluster c
      LEFT JOIN insight_cluster_member m ON m.cluster_id = c.id
      LEFT JOIN insight_signal s ON s.id = m.signal_id
       AND s.signal_at >= ${priorStart}
       AND s.source IN (${Prisma.join(enabled)})
     WHERE c.status = 'active'${domainSql}
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
      sample: r.sample,
      recent,
      prior,
      growth: growthOf(recent, prior),
      tier: tierOf(recent, prior),
    };
  });
}

// ── 源×簇覆盖矩阵(M52 批C;Content Gap 方法论:热源有簇×内部痛源零信号 =
// 内容空白,站内强×外部冷=自有特色)────────────────────────────────────────

export interface SourceMatrixCluster {
  clusterId: bigint;
  kind: string;
  label: string | null;
  score: number | null;
}

export interface SourceMatrixSource {
  source: string;
  /** 该源最近一条信号时间(null=从未有数据) */
  latestAt: string | null;
  /** 源停滞:最近信号早于 SOURCE_STALE_DAYS 天(停滞列零值不参与空白判定) */
  stale: boolean;
}

export interface SourceMatrix {
  /** 活跃簇(按机会分降序取前 N) */
  clusters: SourceMatrixCluster[];
  /** 在役源(固定顺序,列头,带停滞元数据) */
  sources: SourceMatrixSource[];
  /** 计数格:键 `${clusterId}:${source}`;缺格=0 */
  cells: Record<string, number>;
}

/** 源×簇信号计数矩阵(top N 成熟簇 × 在役源;零迁移,member→signal 现表聚合)。
 * 成熟 = 已打标(label 非空)+ 成员 ≥ MATRIX_MIN_MEMBERS——M52 验收实收:单信号
 * 簇 coverage=null 拉满 gap 分,按分排序全屏「待打标」,矩阵不可读且补空白过早。
 * domain(M54 批C):领域视图过滤(undefined=全量)只收簇侧;源健康度列
 * (latestAt/stale)是源属性不随域,cells 按簇 id 集合自然随域 */
export async function listSourceMatrix(limit = 12, domain?: string): Promise<SourceMatrix> {
  const enabled = [...INSIGHT_SOURCES_ENABLED];
  const staleCutoff = new Date(Date.now() - 14 * DAY_MS);
  const domainSql = domain === undefined ? Prisma.empty : Prisma.sql` AND c.domain = ${domain}`;
  const clusters = await prisma.$queryRaw<
    { id: bigint; kind: string; label: string; score: number | null }[]
  >`
    SELECT c.id, c.kind, c.label, c.score
      FROM insight_cluster c
     WHERE c.status = 'active'
       AND c.label IS NOT NULL${domainSql}
       AND (SELECT count(*) FROM insight_cluster_member m WHERE m.cluster_id = c.id)
             >= ${MATRIX_MIN_MEMBERS}
     ORDER BY c.score DESC NULLS LAST
     LIMIT ${limit}`;
  const clusterRows = clusters;
  const ids = clusterRows.map((c) => c.id);
  const matrixClusters: SourceMatrixCluster[] = clusterRows.map((c) => ({
    clusterId: c.id,
    kind: c.kind,
    label: c.label,
    score: c.score,
  }));
  const cells: Record<string, number> = {};
  if (ids.length > 0) {
    const rows = await prisma.$queryRaw<{ cluster_id: bigint; source: string; cnt: bigint }[]>`
      SELECT m.cluster_id, s.source, count(*) AS cnt
        FROM insight_cluster_member m
        JOIN insight_signal s ON s.id = m.signal_id
       WHERE m.cluster_id IN (${Prisma.join(ids)})
         AND s.source IN (${Prisma.join(enabled)})
       GROUP BY m.cluster_id, s.source`;
    for (const r of rows) cells[`${r.cluster_id}:${r.source}`] = Number(r.cnt);
  }
  const latestRows = await prisma.$queryRaw<{ source: string; latest: Date | null }[]>`
    SELECT s.source, max(s.signal_at) AS latest
      FROM insight_signal s
     WHERE s.source IN (${Prisma.join(enabled)})
     GROUP BY s.source`;
  const latestBy = new Map(latestRows.map((r) => [r.source, r.latest]));
  const sources: SourceMatrixSource[] = enabled.map((source) => {
    const latest = latestBy.get(source) ?? null;
    return {
      source,
      latestAt: latest ? latest.toISOString() : null,
      stale: latest === null || latest < staleCutoff,
    };
  });
  return { clusters: matrixClusters, sources, cells };
}
