/**
 * 洞察中心后台读侧(M34 批①雏形→批② 演进,方案 §6):overview(总量/今日/
 * 零结果搜索/日增序列/分源计数)+ listSignals(原始信号流,批② 降为页签)+
 * 批② 簇视图:listClusters(痛点榜/热点雷达数据源,带 7 日快照序列与异动
 * 判定)、getClusterDetail(簇详情:30 日快照/成员信号流/来源分布)。
 * hitCount 存于 meta.jsonb(internal-search 专属),sql 侧 meta->>'hitCount'='0'
 * 判零结果。异动=读侧 isAnomaly 双门判定,不落库(方案 §5.5 看板高亮)。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { statsDay } from "@/lib/datetime";

import { isAnomaly } from "./label";
import { INSIGHT_SOURCE_MEDIUM, type InsightSource } from "./ingest";

/** 北京时区当日零点(与 statsDay/periodKey 同源口径,勿用 UTC 切日) */
function todayStart(now: Date = new Date()): Date {
  return new Date(`${statsDay(now)}T00:00:00+08:00`);
}

export interface InsightSourceStat {
  source: string;
  medium: string;
  total: number;
  today: number;
}

export interface InsightOverview {
  total: number;
  today: number;
  /** 近 7 日零结果搜索数(内容缺口信号;hitCount 增强前旧数据不计入) */
  zeroResultSearch7d: number;
  /** 近 7 日日增(含今日,缺日补 0,旧→新) */
  daily: { date: string; count: number }[];
  bySource: InsightSourceStat[];
}

export interface InsightSignalRow {
  id: string;
  source: string;
  medium: string;
  rawText: string;
  hitCount: number | null;
  zeroResult: boolean;
  signalAt: string;
}

const DAY_MS = 86_400_000;

export async function insightOverview(): Promise<InsightOverview> {
  const start = todayStart();
  const since = new Date(start.getTime() - 6 * DAY_MS);

  const [total, today, totals, todays, dailyRows, zeroRows] = await Promise.all([
    prisma.insightSignal.count(),
    prisma.insightSignal.count({ where: { signalAt: { gte: start } } }),
    prisma.insightSignal.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.insightSignal.groupBy({
      by: ["source"],
      where: { signalAt: { gte: start } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ d: Date; c: bigint }[]>`
      SELECT date_trunc('day', signal_at) AS d, count(*) AS c
      FROM insight_signal
      WHERE signal_at >= ${since}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<{ c: bigint }[]>`
      SELECT count(*) AS c
      FROM insight_signal
      WHERE source = 'internal-search' AND meta->>'hitCount' = '0' AND signal_at >= ${since}
    `,
  ]);

  // 缺日补 0:以北京日界锚定,键=YYYY-MM-DD(序列展示用,不涉 UTC 语义)
  const countByDay = new Map(dailyRows.map((r) => [r.d.toISOString().slice(0, 10), Number(r.c)]));
  const daily = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(since.getTime() + i * DAY_MS);
    const key = day.toISOString().slice(0, 10);
    return { date: key, count: countByDay.get(key) ?? 0 };
  });

  const todayBySource = new Map(todays.map((r) => [r.source, r._count._all]));
  const bySource: InsightSourceStat[] = totals
    .map((r) => ({
      source: r.source,
      medium: INSIGHT_SOURCE_MEDIUM[r.source as InsightSource] ?? "",
      total: r._count._all,
      today: todayBySource.get(r.source) ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    total,
    today,
    zeroResultSearch7d: Number(zeroRows[0]?.c ?? 0),
    daily,
    bySource,
  };
}

const SIGNAL_SELECT = {
  id: true,
  source: true,
  medium: true,
  rawText: true,
  meta: true,
  signalAt: true,
} as const;

/** 最近信号流(可按源过滤);limit 上限 200(雏形页无分页,后续簇视图接管) */
export async function listInsightSignals(opts: {
  source?: InsightSource;
  limit?: number;
}): Promise<InsightSignalRow[]> {
  const rows = await prisma.insightSignal.findMany({
    where: opts.source === undefined ? undefined : { source: opts.source },
    orderBy: { signalAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    select: SIGNAL_SELECT,
  });
  return rows.map((r) => {
    const meta = r.meta as { hitCount?: unknown } | null;
    const hitCount = typeof meta?.hitCount === "number" ? meta.hitCount : null;
    return {
      id: r.id.toString(),
      source: r.source,
      medium: r.medium,
      rawText: r.rawText,
      hitCount,
      zeroResult: hitCount === 0,
      signalAt: r.signalAt.toISOString(),
    };
  });
}

// ── 批② 簇视图(痛点榜/热点雷达/详情)──────────────────────────────────

export interface InsightClusterRow {
  id: string;
  kind: string;
  status: string;
  label: string | null;
  summary: string | null;
  keywords: string[];
  media: string[];
  score: number | null;
  coverageScore: number | null;
  coverageState: string | null;
  members: number;
  /** 最近一次成员信号时间(活跃锚) */
  recentAt: string | null;
  /** 近 7 日快照分升序(sparkline 输入;缺日不补) */
  history: number[];
  /** 异动告警(读侧双门判定,方案 §5.5) */
  anomaly: boolean;
}

const CLUSTER_ROW_TAKE = 20;

/** 簇列表(痛点榜/热点雷达共用;score 降序未计分沉底,再按最近活跃)。
 * 成员数与最近活跃时间二次聚合;7 日快照序列供 sparkline+异动判定 */
export async function listInsightClusters(opts: {
  kind?: "hot" | "pain";
  limit?: number;
}): Promise<InsightClusterRow[]> {
  const take = Math.min(Math.max(opts.limit ?? CLUSTER_ROW_TAKE, 1), 50);
  const clusters = await prisma.insightCluster.findMany({
    where: { status: { not: "closed" }, ...(opts.kind === undefined ? {} : { kind: opts.kind }) },
    orderBy: [{ score: { sort: "desc", nulls: "last" } }, { lastSeenAt: "desc" }],
    take,
    select: {
      id: true,
      kind: true,
      status: true,
      label: true,
      summary: true,
      keywords: true,
      media: true,
      score: true,
      coverageScore: true,
      coverageState: true,
    },
  });
  if (clusters.length === 0) return [];
  const ids = clusters.map((c) => c.id);
  const since = new Date(Date.now() - 7 * DAY_MS);
  const [memberCounts, snaps, recentRows] = await Promise.all([
    prisma.insightClusterMember.groupBy({
      by: ["clusterId"],
      where: { clusterId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.insightSnapshot.findMany({
      where: { clusterId: { in: ids }, date: { gte: since } },
      orderBy: { date: "asc" },
      select: { clusterId: true, score: true },
    }),
    prisma.$queryRaw<{ cluster_id: bigint; recent: Date | null }[]>`
      SELECT m.cluster_id, max(s.signal_at) AS recent
        FROM insight_cluster_member m
        JOIN insight_signal s ON s.id = m.signal_id
       WHERE m.cluster_id IN (${Prisma.join(ids)})
       GROUP BY m.cluster_id`,
  ]);

  const countMap = new Map(memberCounts.map((r) => [r.clusterId, r._count._all]));
  const recentMap = new Map(recentRows.map((r) => [r.cluster_id, r.recent]));
  const historyMap = new Map<bigint, number[]>();
  for (const s of snaps) {
    const arr = historyMap.get(s.clusterId) ?? [];
    arr.push(s.score);
    historyMap.set(s.clusterId, arr);
  }

  return clusters.map((c) => {
    const history = historyMap.get(c.id) ?? [];
    const keywords = Array.isArray(c.keywords)
      ? c.keywords.filter((k): k is string => typeof k === "string")
      : [];
    const media = Array.isArray(c.media)
      ? c.media.filter((m): m is string => typeof m === "string")
      : [];
    const recent = recentMap.get(c.id);
    return {
      id: c.id.toString(),
      kind: c.kind,
      status: c.status,
      label: c.label,
      summary: c.summary,
      keywords,
      media,
      score: c.score,
      coverageScore: c.coverageScore,
      coverageState: c.coverageState,
      members: countMap.get(c.id) ?? 0,
      recentAt: recent ? recent.toISOString() : null,
      history,
      anomaly: isAnomaly(history),
    };
  });
}

export interface InsightClusterDetail {
  cluster: Omit<InsightClusterRow, "history" | "anomaly"> & {
    domain: string;
    labeledAt: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    peakAt: string | null;
    /** 近 30 日快照(升序,缺日不补;热力格输入) */
    snapshots: { date: string; score: number; rank: number | null }[];
  };
  /** 成员信号原话流(最近 50 条) */
  signals: { id: string; source: string; rawText: string; signalAt: string }[];
  /** 来源分布(降序) */
  sourceDist: { source: string; count: number }[];
}

/** 簇详情(详情页数据源;不存在返回 null 交 notFound) */
export async function getInsightClusterDetail(id: bigint): Promise<InsightClusterDetail | null> {
  const cluster = await prisma.insightCluster.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      domain: true,
      status: true,
      label: true,
      summary: true,
      keywords: true,
      media: true,
      score: true,
      coverageScore: true,
      coverageState: true,
      labeledAt: true,
      firstSeenAt: true,
      lastSeenAt: true,
      peakAt: true,
    },
  });
  if (!cluster) return null;

  const [memberCounts, snapshots, signals, sourceRows] = await Promise.all([
    prisma.insightClusterMember.count({ where: { clusterId: id } }),
    prisma.insightSnapshot.findMany({
      where: { clusterId: id },
      orderBy: { date: "asc" },
      take: 30,
      select: { date: true, score: true, rank: true },
    }),
    prisma.insightSignal.findMany({
      where: { members: { some: { clusterId: id } } },
      orderBy: { signalAt: "desc" },
      take: 50,
      select: { id: true, source: true, rawText: true, signalAt: true },
    }),
    prisma.insightSignal.groupBy({
      by: ["source"],
      where: { members: { some: { clusterId: id } } },
      _count: { _all: true },
    }),
  ]);

  const keywords = Array.isArray(cluster.keywords)
    ? cluster.keywords.filter((k): k is string => typeof k === "string")
    : [];
  const media = Array.isArray(cluster.media)
    ? cluster.media.filter((m): m is string => typeof m === "string")
    : [];
  return {
    cluster: {
      id: cluster.id.toString(),
      kind: cluster.kind,
      domain: cluster.domain,
      status: cluster.status,
      label: cluster.label,
      summary: cluster.summary,
      keywords,
      media,
      score: cluster.score,
      coverageScore: cluster.coverageScore,
      coverageState: cluster.coverageState,
      members: memberCounts,
      recentAt: null,
      labeledAt: cluster.labeledAt?.toISOString() ?? null,
      firstSeenAt: cluster.firstSeenAt.toISOString(),
      lastSeenAt: cluster.lastSeenAt.toISOString(),
      peakAt: cluster.peakAt?.toISOString() ?? null,
      snapshots: snapshots.map((s) => ({
        date: s.date.toISOString().slice(0, 10),
        score: s.score,
        rank: s.rank,
      })),
    },
    signals: signals.map((s) => ({
      id: s.id.toString(),
      source: s.source,
      rawText: s.rawText,
      signalAt: s.signalAt.toISOString(),
    })),
    sourceDist: sourceRows
      .map((r) => ({ source: r.source, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}
