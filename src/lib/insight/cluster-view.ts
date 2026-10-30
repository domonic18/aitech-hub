/**
 * 簇视图读侧(痛点榜/热点雷达/详情;M47 批D 自 admin.ts 切出,拆文件守
 * 350 行线,先例 cluster-extras):listClusters(带 7 日快照序列与异动判定)、
 * getClusterDetail(簇详情:30 日快照/成员信号流/来源分布)。异动=读侧
 * isAnomaly 双门判定,不落库。兼容出口住 admin.ts。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { DAY_MS } from "@/lib/datetime";

import { clusterMomentum, isAnomaly, type ClusterMomentum } from "./scoring";
import { CLUSTER_TAKE_MAX } from "./constants";

export interface InsightClusterRow {
  id: string;
  kind: string;
  status: string;
  label: string | null;
  summary: string | null;
  keywords: string[];
  media: string[];
  /** 簇地域(M58 批①:cn | global | mixed) */
  region: string | null;
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
 * 成员数与最近活跃时间二次聚合;7 日快照序列供 sparkline+异动判定。
 * domain(M54 批C):领域视图过滤(undefined=全量)——簇已同域分桶,簇侧
 * where 即成员语义域,无需下探 member/signal */
export async function listInsightClusters(opts: {
  kind?: "hot" | "pain";
  domain?: string;
  limit?: number;
}): Promise<InsightClusterRow[]> {
  const take = Math.min(Math.max(opts.limit ?? CLUSTER_ROW_TAKE, 1), CLUSTER_TAKE_MAX);
  const clusters = await prisma.insightCluster.findMany({
    where: {
      status: { not: "closed" },
      ...(opts.kind === undefined ? {} : { kind: opts.kind }),
      ...(opts.domain === undefined ? {} : { domain: opts.domain }),
    },
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
      region: true,
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
      region: c.region,
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
      region: true,
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
      region: cluster.region,
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
