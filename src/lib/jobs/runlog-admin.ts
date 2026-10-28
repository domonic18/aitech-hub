/**
 * 任务运行台账读侧(验收二批③,admin 运行页「日志/健康」页签):过滤分页明细 +
 * 按 job_key SQL 聚合健康(24h/7d 成功率、最近成败、平均耗时、连败、挂起疑似)。
 * 连败为纯函数(键内按时间倒序数连续 failed);挂起 = running 超 1h(批任务
 * 分钟级,1h 未终态基本可断定执行体挂死)。
 */
import type { JobRun } from "@prisma/client";

import { prisma } from "@/lib/db";
import { startOfCnDay } from "@/lib/datetime";

import { consecutiveFails } from "./runlog";

export { consecutiveFails };

export const JOB_RUN_PAGE_SIZE = 50;

/** running 视为挂起的时长阈值 */
export const JOB_RUN_HUNG_AFTER_MS = 3_600_000;

/** 任务键 → 人话标签(新增落账任务在 worker/job-run 白名单同批在此补一行) */
export const JOB_RUN_LABELS: Record<string, string> = {
  "insight/fetch": "洞察·热榜拉取",
  "insight/daily": "洞察·日批分析",
  "insight/embed": "洞察·向量回填",
  "discovery/discovery-hotwords": "发现·热词采集",
  "discovery/discovery-bili": "发现·B站发现",
  "db-backup/run": "运维·数据库备份",
  "media-audit/audit": "媒体·体检",
  "pricing/sync-openrouter": "牌价·预填",
  "pay-reconcile/daily-audit": "支付·日对账",
  "stats/purge-visit-log": "清理·访问明细",
  "stats/purge-usage-log": "清理·用量台账",
  "stats/purge-agent-session": "清理·会话",
  "stats/purge-job-run": "清理·任务台账",
  "cover-gen/temp-sweep": "封面·候选清扫",
  "crawler/ai-backfill": "解读·AI 补扫",
};

export function jobRunLabel(key: string): string {
  return JOB_RUN_LABELS[key] ?? key;
}

export interface JobRunListFilter {
  key?: string;
  status?: string;
  /** 仅今天(北京自然日,F18「今天|全部」范围筛选) */
  today?: boolean;
  page?: number;
}

export async function listJobRuns(filter: JobRunListFilter): Promise<{
  rows: JobRun[];
  total: number;
  page: number;
  pages: number;
}> {
  const page = Math.max(1, filter.page ?? 1);
  const where = {
    ...(filter.key === undefined ? {} : { jobKey: filter.key }),
    ...(filter.status === undefined ? {} : { status: filter.status }),
    ...(filter.today === true ? { startedAt: { gte: startOfCnDay() } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.jobRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: JOB_RUN_PAGE_SIZE,
      skip: (page - 1) * JOB_RUN_PAGE_SIZE,
    }),
    prisma.jobRun.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / JOB_RUN_PAGE_SIZE)) };
}

/** F18 状态计数 chips(随 key/today 过滤,不随 status——chips 本身就是状态入口) */
export async function jobRunStatusCounts(
  filter: Pick<JobRunListFilter, "key" | "today">,
): Promise<{ running: number; success: number; failed: number }> {
  const rows = await prisma.jobRun.groupBy({
    by: ["status"],
    where: {
      ...(filter.key === undefined ? {} : { jobKey: filter.key }),
      ...(filter.today === true ? { startedAt: { gte: startOfCnDay() } } : {}),
    },
    _count: { _all: true },
  });
  const out = { running: 0, success: 0, failed: 0 };
  for (const r of rows) {
    if (r.status in out) out[r.status as keyof typeof out] = r._count._all;
  }
  return out;
}

export interface JobKeyHealth {
  jobKey: string;
  total24h: number;
  success24h: number;
  total7d: number;
  fail7d: number;
  runningNow: number;
  lastSuccessAt: Date | null;
  lastFailedAt: Date | null;
  avgDurationMs: number | null;
  /** F19 归因:末次失败轮的 error(截 200 字;无失败 → null) */
  lastError: string | null;
}

/** 连败纯函数见 ./runlog(顶部 re-export);此处只做聚合查询 */

export interface JobRunHealth {
  keys: JobKeyHealth[];
  /** 挂起疑似:running 超 JOB_RUN_HUNG_AFTER_MS */
  hung: Array<{ id: bigint; jobKey: string; startedAt: Date }>;
  /** 键 → 连败数(仅 >0 才有键) */
  streaks: Record<string, number>;
}

/** 健康聚合:一条 SQL 出全部键的窗口统计(含仍在跑的 running 行),连败与挂起各一查 */
export async function jobRunHealth(): Promise<JobRunHealth> {
  const [keys, hung, streakRows] = await Promise.all([
    prisma.$queryRaw<JobKeyHealth[]>`
      SELECT job_key AS "jobKey",
        COUNT(*) FILTER (WHERE started_at >= now() - interval '24 hours')::int AS "total24h",
        COUNT(*) FILTER (WHERE status = 'success' AND started_at >= now() - interval '24 hours')::int AS "success24h",
        COUNT(*) FILTER (WHERE started_at >= now() - interval '7 days')::int AS "total7d",
        COUNT(*) FILTER (WHERE status = 'failed' AND started_at >= now() - interval '7 days')::int AS "fail7d",
        COUNT(*) FILTER (WHERE status = 'running')::int AS "runningNow",
        MAX(started_at) FILTER (WHERE status = 'success') AS "lastSuccessAt",
        MAX(started_at) FILTER (WHERE status = 'failed') AS "lastFailedAt",
        AVG(duration_ms) FILTER (WHERE started_at >= now() - interval '7 days')::float AS "avgDurationMs",
        (SELECT left(j2.error, 200) FROM job_run j2
          WHERE j2.job_key = job_run.job_key AND j2.status = 'failed'
          ORDER BY j2.started_at DESC LIMIT 1) AS "lastError"
      FROM job_run
      WHERE started_at >= now() - interval '7 days' OR status = 'running'
      GROUP BY job_key
      ORDER BY job_key`,
    prisma.jobRun.findMany({
      where: { status: "running", startedAt: { lt: new Date(Date.now() - JOB_RUN_HUNG_AFTER_MS) } },
      orderBy: { startedAt: "asc" },
      select: { id: true, jobKey: true, startedAt: true },
    }),
    prisma.$queryRaw<{ jobKey: string; status: string }[]>`
      SELECT job_key AS "jobKey", status
      FROM (
        SELECT job_key, status,
          ROW_NUMBER() OVER (PARTITION BY job_key ORDER BY started_at DESC) AS rn
        FROM job_run
        WHERE status <> 'running' AND started_at >= now() - interval '7 days'
      ) t
      WHERE rn <= 20
      ORDER BY "jobKey", rn`,
  ]);

  const byKey = new Map<string, string[]>();
  for (const r of streakRows) {
    const list = byKey.get(r.jobKey) ?? [];
    list.push(r.status);
    byKey.set(r.jobKey, list);
  }
  const streaks: Record<string, number> = {};
  for (const [key, list] of byKey) {
    const n = consecutiveFails(list);
    if (n > 0) streaks[key] = n;
  }
  return { keys, hung, streaks };
}

/** 末次运行原行(组件层裸 Prisma 下沉,M48 批F;jobKey 精确匹配) */
export async function latestJobRun(jobKey: string): Promise<JobRun | null> {
  return prisma.jobRun.findFirst({ where: { jobKey }, orderBy: { startedAt: "desc" } });
}
