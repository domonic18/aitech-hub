/**
 * 洞察日批编排(M34 批②,方案 §5.5-§5.6;原 label.ts 内联段拆出,文件 ≤350
 * 纪律):LLM 打标段在 label.ts,此处聚合机械段——机会评分 + 每日快照 +
 * fading 兜底 + 痛点簇覆盖度。打标与机械段解耦:LLM 不可用日照常演进。
 */
import { AI_PURPOSE_INSIGHT } from "../ai/constants";
import { countTodayRoleUsage } from "../ai/usage-queries";
import { getRoleDailyMax, resolveAiModel } from "../ai/resolver";
import { prisma } from "../db";
import { logger } from "../logger";
import { statsDay } from "../datetime";
import { topVectorMatches } from "../search/embedding-repo";
import {
  COVERAGE_MATCH_DISTANCE,
  COVERAGE_TOPK,
  FADE_AFTER_DAYS,
  LABEL_BATCH_SIZE,
  SCORE_HEAT_WINDOW_DAYS,
} from "./constants";
import { getClusterCentroid } from "./embedding-repo";
import { findStaleClusters, labelCluster } from "./label";
import { computeCoverageScore, computeOpportunityScore, coverageStateOf } from "./scoring";

// ── 覆盖度/评分/快照段 ────────────────────────────────────────────────

interface ActiveClusterStat {
  id: bigint;
  kind: string;
  members: number;
  heatNew: number;
  media: string[];
}

/** 活跃簇机械段聚合(成员数/近 7 日新增热度/介质并集,一条 SQL 出全量) */
async function fetchActiveClusterStats(since: Date): Promise<ActiveClusterStat[]> {
  const rows = await prisma.$queryRaw<
    {
      id: bigint;
      kind: string;
      members: bigint;
      heat: bigint;
      media: string[];
    }[]
  >`
    SELECT c.id,
           c.kind,
           count(m.id) AS members,
           count(s.id) FILTER (WHERE s.signal_at >= ${since}) AS heat,
           COALESCE(array_agg(DISTINCT s.medium) FILTER (WHERE s.medium IS NOT NULL), '{}') AS media
      FROM insight_cluster c
      LEFT JOIN insight_cluster_member m ON m.cluster_id = c.id
      LEFT JOIN insight_signal s ON s.id = m.signal_id
     WHERE c.status = 'active'
     GROUP BY c.id, c.kind`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    members: Number(r.members),
    heatNew: Number(r.heat),
    media: r.media ?? [],
  }));
}

/** 痛点簇覆盖度:质心 → post 向量近邻(方案 §5.6;无标签/无质心跳过) */
async function refreshCoverage(clusterId: bigint): Promise<void> {
  const [centroid, labeled] = await Promise.all([
    getClusterCentroid(clusterId),
    prisma.insightCluster.findUnique({
      where: { id: clusterId },
      select: { label: true, kind: true },
    }),
  ]);
  if (!centroid || !labeled?.label || labeled.kind !== "pain") return;
  const matches = await topVectorMatches("post", centroid, COVERAGE_TOPK);
  const matched = matches.filter((m) => m.distance <= COVERAGE_MATCH_DISTANCE);
  const best = matched[0]?.distance ?? matches[0]?.distance ?? 1;
  const score = matched.length > 0 ? computeCoverageScore(best, matched.length) : 0;
  await prisma.insightCluster.update({
    where: { id: clusterId },
    data: { coverageScore: score, coverageState: coverageStateOf(score) },
    select: { id: true },
  });
}

/** 每日快照 upsert(北京日界;rank=同 kind 内分数名次) */
async function upsertSnapshots(
  scored: { id: bigint; kind: string; score: number }[],
  date: string,
): Promise<void> {
  const rankByKind = new Map<string, number>();
  const withRank = [...scored]
    .sort((a, b) => b.score - a.score)
    .map((r) => {
      const rank = (rankByKind.get(r.kind) ?? 0) + 1;
      rankByKind.set(r.kind, rank);
      return { ...r, rank };
    });
  for (const r of withRank) {
    await prisma.$executeRaw`
      INSERT INTO insight_snapshot (cluster_id, date, score, rank)
      VALUES (${r.id}::bigint, ${date}::date, ${r.score}::float8, ${r.rank}::int)
      ON CONFLICT (cluster_id, date) DO UPDATE
        SET score = EXCLUDED.score, rank = EXCLUDED.rank`;
  }
}

// ── 日批编排 ──────────────────────────────────────────────────────────

export interface InsightDailySummary {
  labeled: number;
  labelFailed: number;
  /** 打标跳过(未绑定 insight 模型或当日配额已满) */
  labelSkipped: boolean;
  scored: number;
  snapshots: number;
  faded: number;
  covered: number;
}

/** 洞察日批主流程(worker cron 与手动脚本共用;process 级自愈,不抛) */
export async function runInsightDaily(): Promise<InsightDailySummary> {
  const summary: InsightDailySummary = {
    labeled: 0,
    labelFailed: 0,
    labelSkipped: false,
    scored: 0,
    snapshots: 0,
    faded: 0,
    covered: 0,
  };
  const model = await resolveAiModel(AI_PURPOSE_INSIGHT);
  if (!model) {
    logger.info({ event: "insight.daily_label_skipped", reason: "insight_unbound" });
    summary.labelSkipped = true;
  } else {
    const [used, dailyMax] = await Promise.all([
      countTodayRoleUsage(AI_PURPOSE_INSIGHT),
      getRoleDailyMax(AI_PURPOSE_INSIGHT),
    ]);
    const quota = Math.max(0, dailyMax - used);
    if (quota === 0) {
      logger.info({ event: "insight.daily_label_skipped", reason: "quota_exhausted" });
      summary.labelSkipped = true;
    } else {
      const stale = await findStaleClusters(Math.min(quota, LABEL_BATCH_SIZE));
      for (const c of stale) {
        try {
          if (await labelCluster(c.id, Number(c.members), model)) summary.labeled += 1;
          else summary.labelFailed += 1;
        } catch (e) {
          summary.labelFailed += 1;
          logger.warn({
            event: "insight.label_cluster_failed",
            clusterId: c.id.toString(),
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  // 机械段:评分 + 快照 + fading(与打标解耦,LLM 不可用日照常演进)
  const now = new Date();
  const since = new Date(now.getTime() - SCORE_HEAT_WINDOW_DAYS * 86_400_000);
  const [stats, activeRows] = await Promise.all([
    fetchActiveClusterStats(since),
    prisma.insightCluster.findMany({
      where: { status: "active" },
      select: { id: true, score: true, peakAt: true, coverageScore: true },
    }),
  ]);
  const activeById = new Map(activeRows.map((r) => [r.id, r]));
  const scored = stats
    .filter((s) => s.members > 0)
    .map((s) => {
      const prev = activeById.get(s.id);
      return {
        id: s.id,
        kind: s.kind,
        score: computeOpportunityScore({
          mediaCount: s.media.length,
          heatNew: s.heatNew,
          coverage: prev?.coverageScore ?? null,
        }),
        prevScore: prev?.score ?? null,
        hadPeak: prev?.peakAt !== null && prev?.peakAt !== undefined,
      };
    });
  const nowMs = Date.now();
  for (const s of scored) {
    await prisma.insightCluster.update({
      where: { id: s.id },
      data: {
        score: s.score,
        // 首次计分或创新高 → peakAt=now(峰值锚点,雷达趋势读侧用)
        peakAt: !s.hadPeak || (s.prevScore ?? -1) < s.score ? new Date(nowMs) : undefined,
      },
      select: { id: true },
    });
  }
  summary.scored = scored.length;
  await upsertSnapshots(scored, statsDay(now));
  summary.snapshots = scored.length;

  const cutoff = new Date(nowMs - FADE_AFTER_DAYS * 86_400_000);
  summary.faded = await prisma.$executeRaw`
    UPDATE insight_cluster SET status = 'fading'
     WHERE status = 'active' AND last_seen_at < ${cutoff}`;

  // 覆盖度只重算已打标痛点簇(标签变化后次日回写,量级=数十,可承受)
  const covTargets = await prisma.insightCluster.findMany({
    where: { kind: "pain", status: "active", label: { not: null } },
    select: { id: true },
  });
  for (const t of covTargets) {
    try {
      await refreshCoverage(t.id);
      summary.covered += 1;
    } catch (e) {
      logger.warn({
        event: "insight.coverage_failed",
        clusterId: t.id.toString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  logger.info({ event: "insight.daily", ...summary });
  return summary;
}
