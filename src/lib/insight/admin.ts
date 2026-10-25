/**
 * 洞察中心后台读侧(M34 批①雏形→批②③ 演进,方案 §6):overview(总量/今日/
 * 日增序列/分源计数)+ listSignals(原始信号流)。批③ 渠道转向:全部读侧恒限
 * 在役源白名单(INSIGHT_SOURCES_ENABLED),站内搜索/agent/反馈存量行不再
 * 呈现;零结果搜索指标随源退出移除。
 * 簇视图(M47 批D 切出至 ./cluster-view,拆文件守 350 行线)与簇详情附加取数
 * (./cluster-extras)各自成文,此处留兼容出口。
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { statsDay } from "@/lib/datetime";

import { SIGNAL_TAKE_DEFAULT, SIGNAL_TAKE_MAX } from "./constants";
import { INSIGHT_SOURCES_ENABLED, INSIGHT_SOURCE_MEDIUM, type InsightSource } from "./ingest";

// ── 兼容出口:既有调用方(页面/组件/测试)仍从 admin 取,实现住各自模块 ──
export {
  listInsightClusters,
  getInsightClusterDetail,
  type InsightClusterRow,
  type InsightClusterDetail,
} from "./cluster-view";

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
  /** 近 windowDays 日日增(含今日,缺日补 0,旧→新;北京日界) */
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
    prisma.$queryRaw<{ d: string; c: bigint }[]>`
      SELECT to_char(signal_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS d, count(*) AS c
      FROM insight_signal
      WHERE signal_at >= ${since} AND source IN (${Prisma.join(ENABLED)})
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  // 缺日补 0:键=北京日(SQL 显式 AT TIME ZONE 切桶,与 trends.ts 同口径;
  // 曾用 UTC date_trunc → 日界错 8 小时,今日 8 点后信号落出序列尾部)
  const countByDay = new Map(dailyRows.map((r) => [r.d, Number(r.c)]));
  const [y, m, d] = statsDay(since).split("-").map(Number);
  const anchorUtc = Date.UTC(y, m - 1, d);
  const daily = Array.from({ length: window }, (_, i) => {
    const date = new Date(anchorUtc + i * DAY_MS).toISOString().slice(0, 10);
    return { date, count: countByDay.get(date) ?? 0 };
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
    take: Math.min(Math.max(opts.limit ?? SIGNAL_TAKE_DEFAULT, 1), SIGNAL_TAKE_MAX),
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
