/**
 * 洞察中心后台读侧(M34 批①雏形,方案 §6):未聚类先按源分组——overview 出
 * 总量/今日新增/近 7 日日增序列(sparkline 输入)/分源计数/零结果搜索数
 * (零结果=内容缺口,痛点侧核心指标);listSignals 出最近信号流(可按源过滤)。
 * hitCount 存于 meta.jsonb(internal-search 专属),sql 侧 meta->>'hitCount'='0'
 * 判零结果。批② 聚类上线后本文件演进为簇视图数据源,按源分组保留为原始信号页签。
 */
import { prisma } from "@/lib/db";
import { statsDay } from "@/lib/datetime";

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
