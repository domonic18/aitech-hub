/**
 * 采集总览读侧(M7 批④c):crawler 队列实况(BullMQ)+ 采集日历(14 天,
 * 北京时区按日补零)+ 库存概况。日期边界 JS 侧算好作参数,SQL 禁 now()
 * (与 stats/queries 同一时区纪律)。
 */
import { AI_PURPOSE_INTERPRET } from "../ai/constants";
import { getRoleDailyMax } from "../ai/resolver";
import { prisma } from "../db";
import { formatCnDate } from "../datetime";
import { getQueue, QUEUE_CRAWLER, QUEUE_INTERPRETER } from "../queue";
import { TELEGRAM_AI_TERMINAL, TELEGRAM_MEDIA_VIDEO } from "./constants";

const TICK_SCHEDULER_ID = "crawler-tick";

export interface QueueSnapshot {
  counts: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  tickAlive: boolean;
  recentFailed: Array<{ id: string; name: string; reason: string; at: Date | null }>;
}

/** 队列实况:计数 + tick 调度器存活 + 最近 5 条失败(后台「最近错误」) */
export async function getCrawlerQueueSnapshot(): Promise<QueueSnapshot> {
  const queue = getQueue(QUEUE_CRAWLER);
  const counts = (await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
  )) as Record<string, number>;
  const schedulers = await queue.getJobSchedulers();
  const failed = await queue.getFailed(0, 5);
  return {
    counts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    },
    tickAlive: schedulers.some((s) => s.key === TICK_SCHEDULER_ID),
    recentFailed: failed.map((j) => ({
      id: j.id ?? "",
      name: j.name,
      reason: (j.failedReason ?? "").slice(0, 200),
      at: j.finishedOn ? new Date(j.finishedOn) : null,
    })),
  };
}

/** interpreter 队列实况(M9):四计数 + 今日已判读/日配额(worker 并发 1 说明在页侧) */
export async function getInterpreterQueueSnapshot(): Promise<{
  counts: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  todayDone: number;
  dailyMax: number;
}> {
  const queue = getQueue(QUEUE_INTERPRETER);
  const counts = (await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
  )) as Record<string, number>;
  return {
    counts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    },
    todayDone: await countTodayInterpreted(),
    dailyMax: await getRoleDailyMax(AI_PURPOSE_INTERPRET),
  };
}

/** 服务器本地自然日零点(与 interpret-video 配额计数同口径) */
function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 今日已解读数(终态口径单点:观测台与配额判定共用,防两侧口径漂移) */
export async function countTodayInterpreted(): Promise<number> {
  return prisma.telegram.count({
    where: {
      aiRanAt: { gte: todayStart() },
      aiStatus: { in: [...TELEGRAM_AI_TERMINAL] },
    },
  });
}

/** 采集日历:近 N 天入库量(含 hidden,按 created_at 北京时区),缺日补零 */
export async function getIngestCalendar(days = 14): Promise<Array<{ day: string; count: number }>> {
  const today = formatCnDate(new Date());
  const fromDay = formatCnDate(new Date(Date.now() - (days - 1) * 86_400_000));
  const rows = await prisma.$queryRaw<Array<{ day: string; count: bigint }>>`
    WITH d AS (
      SELECT generate_series(${fromDay}::date, ${today}::date, interval '1 day')::date AS day
    )
    SELECT d.day::text AS day, count(t.id) AS count
    FROM d
    LEFT JOIN telegram t
      ON (t.created_at AT TIME ZONE 'Asia/Shanghai')::date = d.day
    GROUP BY d.day
    ORDER BY d.day`;
  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

/** 库存概况:各状态条目量 */
export async function getTelegramStock(): Promise<Record<string, number>> {
  const groups = await prisma.telegram.groupBy({ by: ["status"], _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const g of groups) out[g.status] = g._count._all;
  return out;
}

/**
 * 最近 24 小时逐小时入库量(整点槽补零;原型 admin-spider 24h 条带)。
 * 槽边界 JS 算好作参数(SQL 禁 now());+08:00 为整小时偏移,UTC 整点即北京整点。
 */
export async function getIngestHourly(): Promise<Array<{ hourLabel: string; count: number }>> {
  const end = new Date();
  end.setMinutes(0, 0, 0);
  const start = new Date(end.getTime() - 23 * 3_600_000);
  const rows = await prisma.$queryRaw<Array<{ h: Date; count: bigint }>>`
    WITH slots AS (
      SELECT generate_series(${start}::timestamptz, ${end}::timestamptz, interval '1 hour') AS h
    )
    SELECT s.h, count(t.id) AS count
    FROM slots s
    LEFT JOIN telegram t ON t.created_at >= s.h AND t.created_at < s.h + interval '1 hour'
    GROUP BY s.h ORDER BY s.h`;
  return rows.map((r) => ({
    hourLabel: new Intl.DateTimeFormat("sv-SE", {
      hour: "2-digit",
      timeZone: "Asia/Shanghai",
    }).format(r.h),
    count: Number(r.count),
  }));
}

/** 短视频观测(M8 批③):博主数/调度中/24h 视频入库/最新一条时间 */
export async function getVideoObservation(): Promise<{
  bloggerCount: number;
  enabledCount: number;
  videoCount24h: number;
  lastVideoAt: Date | null;
}> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [bloggerCount, enabledCount, videoCount24h, last] = await Promise.all([
    prisma.socialAccount.count(),
    prisma.socialAccount.count({ where: { enabled: true } }),
    prisma.telegram.count({
      where: { mediaType: TELEGRAM_MEDIA_VIDEO, createdAt: { gte: since } },
    }),
    prisma.telegram.findFirst({
      where: { mediaType: TELEGRAM_MEDIA_VIDEO },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return { bloggerCount, enabledCount, videoCount24h, lastVideoAt: last?.createdAt ?? null };
}
