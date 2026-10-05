/**
 * 采集总览读侧(M7 批④c):crawler 队列实况(BullMQ)+ 采集日历(14 天,
 * 北京时区按日补零)+ 库存概况。日期边界 JS 侧算好作参数,SQL 禁 now()
 * (与 stats/queries 同一时区纪律)。
 */
import { AI_PURPOSE_INTERPRET, AI_PURPOSE_SUMMARIZE, type AiTaskRole } from "../ai/constants";
import { getRoleDailyMax } from "../ai/resolver";
import { prisma } from "../db";
import { formatCnDate } from "../datetime";
import {
  getQueue,
  QUEUE_CRAWLER,
  QUEUE_GITHUB,
  QUEUE_INTERPRETER,
  QUEUE_NAMES,
  QUEUE_SUMMARIZER,
} from "../queue";
import {
  TELEGRAM_AI_MISSING_TRANSCRIPT,
  TELEGRAM_AI_TERMINAL,
  TELEGRAM_MEDIA_TEXT,
  TELEGRAM_MEDIA_VIDEO,
  type TelegramMediaType,
} from "./constants";

export interface QueueSnapshot {
  counts: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  tickAlive: boolean;
  recentFailed: Array<{ id: string; name: string; reason: string; at: Date | null }>;
}

/** 队列实况共性:计数 + tick 调度器存活 + 最近 5 条失败(crawler/github 共用) */
async function snapshotQueue(
  queueName: (typeof QUEUE_NAMES)[number],
  tickSchedulerId: string,
): Promise<QueueSnapshot> {
  const queue = getQueue(queueName);
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
    tickAlive: schedulers.some((s) => s.key === tickSchedulerId),
    recentFailed: failed.map((j) => ({
      id: j.id ?? "",
      name: j.name,
      reason: (j.failedReason ?? "").slice(0, 200),
      at: j.finishedOn ? new Date(j.finishedOn) : null,
    })),
  };
}

/** crawler 队列实况:计数 + tick 调度器存活 + 最近 5 条失败(后台「最近错误」) */
export function getCrawlerQueueSnapshot(): Promise<QueueSnapshot> {
  return snapshotQueue(QUEUE_CRAWLER, "crawler-tick");
}

/** github 队列实况(M11):同步 job 计数 + 白名单台账计数(调度中/总数) */
export async function getGithubQueueSnapshot(): Promise<
  QueueSnapshot & { repoCount: number; enabledCount: number }
> {
  const [snapshot, repoCount, enabledCount] = await Promise.all([
    snapshotQueue(QUEUE_GITHUB, "github-tick"),
    prisma.githubRepo.count(),
    prisma.githubRepo.count({ where: { enabled: true } }),
  ]);
  return { ...snapshot, repoCount, enabledCount };
}

/** AI 解读/摘要队列实况共性(M12 批③):job 计数 + 今日已判读(mediaType 拆分)/日配额。
 * M15 批④ 增最老等待年龄——BullMQ Worker 事件驱动无轮询周期,该值用于感知
 * 消化速率(delayed 峰=配额顺延重投,waiting 长龄=并发 1 串行积压)。 */
interface AiQueueSnapshot {
  counts: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  todayDone: number;
  dailyMax: number;
  /** waiting 头部 job 的已等待毫秒(入队 timestamp 起);无 waiting job → null */
  oldestWaitingMs: number | null;
}

async function aiQueueSnapshot(
  queueName: (typeof QUEUE_NAMES)[number],
  role: AiTaskRole,
  mediaType: TelegramMediaType,
): Promise<AiQueueSnapshot> {
  const queue = getQueue(queueName);
  const [countsRaw, head] = await Promise.all([
    queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
    queue.getWaiting(0, 1),
  ]);
  const counts = countsRaw as Record<string, number>;
  const oldest = head[0];
  return {
    counts: {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    },
    todayDone: await countTodayAiDone(mediaType),
    dailyMax: await getRoleDailyMax(role),
    oldestWaitingMs: oldest?.timestamp != null ? Date.now() - oldest.timestamp : null,
  };
}

/** interpreter 队列实况(M9):四计数 + 今日已判读(视频行)/日配额(worker 并发 1 说明在页侧) */
export function getInterpreterQueueSnapshot(): Promise<AiQueueSnapshot> {
  return aiQueueSnapshot(QUEUE_INTERPRETER, AI_PURPOSE_INTERPRET, TELEGRAM_MEDIA_VIDEO);
}

/** summarizer 队列实况(M12 批③):文字轻解读 job 计数 + 今日已摘要(文字行)/日配额 */
export function getSummarizerQueueSnapshot(): Promise<AiQueueSnapshot> {
  return aiQueueSnapshot(QUEUE_SUMMARIZER, AI_PURPOSE_SUMMARIZE, TELEGRAM_MEDIA_TEXT);
}

/** 服务器本地自然日零点(与 interpret-video/summarize-text 配额计数同口径) */
function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface AsrOverview {
  /** 今日完成转写+解读的视频数(终态口径,含降级) */
  todayDone: number;
  /** 今日已处理视频时长合计秒(转写时长口径) */
  todayDurationSec: number;
  /** interpreter 队列 waiting+active */
  queueWaiting: number;
  /** 今日降级数(ASR 终败 missing_transcript,LLM 已实际消耗) */
  todayDegraded: number;
}

/** ASR 转写总览(2026-10-06 验收反馈问题4,原型 admin-bloggers「ASR 转写」统计卡):
 * 今日转写 / 排队中 / 今日降级;服务状态读 asr_config 由页侧另取。 */
export async function getAsrOverview(): Promise<AsrOverview> {
  const today = todayStart();
  const [agg, degraded, interpreter] = await Promise.all([
    prisma.telegram.aggregate({
      where: {
        mediaType: TELEGRAM_MEDIA_VIDEO,
        aiRanAt: { gte: today },
        aiStatus: { in: [...TELEGRAM_AI_TERMINAL] },
      },
      _count: { _all: true },
      _sum: { videoDuration: true },
    }),
    prisma.telegram.count({
      where: {
        mediaType: TELEGRAM_MEDIA_VIDEO,
        aiStatus: TELEGRAM_AI_MISSING_TRANSCRIPT,
        aiRanAt: { gte: today },
      },
    }),
    getInterpreterQueueSnapshot(),
  ]);
  return {
    todayDone: agg._count._all,
    todayDurationSec: Number(agg._sum.videoDuration ?? 0),
    queueWaiting: interpreter.counts.waiting + interpreter.counts.active,
    todayDegraded: degraded,
  };
}

/** 今日已完成 AI 处理数(终态口径单点:观测台与配额判定共用,防两侧口径漂移)。
 * M12 批③ 按 mediaType 拆分:interpret 数视频行、summarize 数文字行,两角色
 * 日配额互不侵占(终态含 missing_transcript 降级——LLM 已实际消耗)。 */
export async function countTodayAiDone(mediaType: TelegramMediaType): Promise<number> {
  return prisma.telegram.count({
    where: {
      aiRanAt: { gte: todayStart() },
      aiStatus: { in: [...TELEGRAM_AI_TERMINAL] },
      mediaType,
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
