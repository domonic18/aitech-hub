/**
 * 洞察中心后台读侧(M34 批①雏形→批②③ 演进,方案 §6):overview(总量/今日/
 * 日增序列/分源计数)+ listSignals(原始信号流)+ 簇视图:listClusters
 * (痛点榜/热点雷达数据源,带 7 日快照序列与异动判定)、getClusterDetail
 * (簇详情:30 日快照/成员信号流/来源分布)。批③ 渠道转向:全部读侧恒限
 * 在役源白名单(INSIGHT_SOURCES_ENABLED),站内搜索/agent/反馈存量行不再
 * 呈现;零结果搜索指标随源退出移除。异动=读侧 isAnomaly 双门判定,不落库。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { statsDay } from "@/lib/datetime";

import { clusterMomentum, isAnomaly, type ClusterMomentum } from "./scoring";
import { INSIGHT_SOURCES_ENABLED, INSIGHT_SOURCE_MEDIUM, type InsightSource } from "./ingest";

/** 北京时区当日零点(与 statsDay/periodKey 同源口径,勿用 UTC 切日) */
function todayStart(now: Date = new Date()): Date {
  return new Date(`${statsDay(now)}T00:00:00+08:00`);
}

/** 在役源(批③ 渠道转向:站内搜索/agent/反馈退出,读侧全量按白名单过滤;
 * 存量行保留库中不再呈现) */
const ENABLED = [...INSIGHT_SOURCES_ENABLED];

export interface InsightSourceStat {
  source: string;
  medium: string;
  total: number;
  today: number;
}

export interface InsightOverview {
  total: number;
  today: number;
  /** 近 windowDays 日日增(含今日,缺日补 0,旧→新) */
  daily: { date: string; count: number }[];
  bySource: InsightSourceStat[];
}

export interface InsightSignalRow {
  id: string;
  source: string;
  medium: string;
  rawText: string;
  signalAt: string;
}

const DAY_MS = 86_400_000;

/** 总览(验收二批②:窗口参数化 7/30/90,读侧不动数据——信号/快照本就逐日
 * 累积,「每天重算」是固定窗口的读侧假象)。windowDays 夹取 1..90 */
export async function insightOverview(windowDays = 7): Promise<InsightOverview> {
  const window = Math.min(Math.max(Math.trunc(windowDays), 1), 90);
  const start = todayStart();
  const since = new Date(start.getTime() - (window - 1) * DAY_MS);

  const [total, today, totals, todays, dailyRows] = await Promise.all([
    prisma.insightSignal.count({ where: { source: { in: ENABLED } } }),
    prisma.insightSignal.count({ where: { source: { in: ENABLED }, signalAt: { gte: start } } }),
    prisma.insightSignal.groupBy({
      by: ["source"],
      where: { source: { in: ENABLED } },
      _count: { _all: true },
    }),
    prisma.insightSignal.groupBy({
      by: ["source"],
      where: { source: { in: ENABLED }, signalAt: { gte: start } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ d: Date; c: bigint }[]>`
      SELECT date_trunc('day', signal_at) AS d, count(*) AS c
      FROM insight_signal
      WHERE signal_at >= ${since} AND source IN (${Prisma.join(ENABLED)})
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  // 缺日补 0:以北京日界锚定,键=YYYY-MM-DD(序列展示用,不涉 UTC 语义)
  const countByDay = new Map(dailyRows.map((r) => [r.d.toISOString().slice(0, 10), Number(r.c)]));
  const daily = Array.from({ length: window }, (_, i) => {
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

  return { total, today, daily, bySource };
}

const SIGNAL_SELECT = {
  id: true,
  source: true,
  medium: true,
  rawText: true,
  signalAt: true,
} as const;

/** 最近信号流(可按源过滤,恒限在役源);from/to 钳 signal_at(北京日界由
 * 调用方折算);limit 上限 200 */
export async function listInsightSignals(opts: {
  source?: InsightSource;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<InsightSignalRow[]> {
  const rows = await prisma.insightSignal.findMany({
    where: {
      AND: [
        { source: { in: ENABLED } },
        ...(opts.source === undefined ? [] : [{ source: opts.source }]),
        ...(opts.from === undefined && opts.to === undefined
          ? []
          : [
              {
                signalAt: {
                  ...(opts.from === undefined ? {} : { gte: opts.from }),
                  ...(opts.to === undefined ? {} : { lt: opts.to }),
                },
              },
            ]),
      ],
    },
    orderBy: { signalAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    select: SIGNAL_SELECT,
  });
  return rows.map((r) => ({
    id: r.id.toString(),
    source: r.source,
    medium: r.medium,
    rawText: r.rawText,
    signalAt: r.signalAt.toISOString(),
  }));
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
  /** 近 24h 新增 / 此前累计信号数(动量判定输入;雷达方向徽) */
  sig24h: number;
  sigBefore: number;
  momentum: ClusterMomentum;
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
    prisma.$queryRaw<
      { cluster_id: bigint; sig_24h: bigint; sig_before: bigint; recent: Date | null }[]
    >`
      SELECT m.cluster_id,
             count(s.id) FILTER (WHERE s.signal_at >= now() - interval '24 hours') AS sig_24h,
             count(s.id) FILTER (WHERE s.signal_at <  now() - interval '24 hours') AS sig_before,
             max(s.signal_at) AS recent
        FROM insight_cluster_member m
        JOIN insight_signal s ON s.id = m.signal_id
       WHERE m.cluster_id IN (${Prisma.join(ids)})
       GROUP BY m.cluster_id`,
  ]);

  const countMap = new Map(memberCounts.map((r) => [r.clusterId, r._count._all]));
  const recentMap = new Map(recentRows.map((r) => [r.cluster_id, r.recent]));
  const sigMap = new Map(recentRows.map((r) => [r.cluster_id, r]));
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
    const sig = sigMap.get(c.id);
    const sig24h = Number(sig?.sig_24h ?? 0);
    const sigBefore = Number(sig?.sig_before ?? 0);
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
      sig24h,
      sigBefore,
      momentum: clusterMomentum(sig24h, sigBefore),
    };
  });
}

export interface InsightClusterDetail {
  cluster: Omit<InsightClusterRow, "history" | "anomaly" | "sig24h" | "sigBefore" | "momentum"> & {
    domain: string;
    labeledAt: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    peakAt: string | null;
    /** 近 30 日快照(升序,缺日不补;热力格输入) */
    snapshots: { date: string; score: number; rank: number | null }[];
  };
  /** 成员信号原话流(最近 50 条;meta 供热度排序与原文链,F26 证据卡用) */
  signals: {
    id: string;
    source: string;
    rawText: string;
    signalAt: string;
    meta: unknown;
  }[];
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
    // 近 8 周(F25 趋势条窗宽):desc 取尾再反转回升序
    prisma.insightSnapshot.findMany({
      where: { clusterId: id },
      orderBy: { date: "desc" },
      take: 56,
      select: { date: true, score: true, rank: true },
    }),
    prisma.insightSignal.findMany({
      where: { members: { some: { clusterId: id } } },
      orderBy: { signalAt: "desc" },
      take: 50,
      select: { id: true, source: true, rawText: true, signalAt: true, meta: true },
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
      snapshots: snapshots
        .map((s) => ({
          date: s.date.toISOString().slice(0, 10),
          score: s.score,
          rank: s.rank,
        }))
        .reverse(),
    },
    signals: signals.map((s) => ({
      id: s.id.toString(),
      source: s.source,
      rawText: s.rawText,
      signalAt: s.signalAt.toISOString(),
      meta: s.meta,
    })),
    sourceDist: sourceRows
      .map((r) => ({ source: r.source, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}
