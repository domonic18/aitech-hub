/**
 * 任务运行台账写侧(验收二批③,学习 ai-invest collector_log):worker 分发器
 * (worker/job-run#withJobRunLog)单一写入口——执行前先落 running 行(挂死
 * 立即可见,不必等超时),终态回写 summary/error/duration。台账自身清理
 * purgeJobRuns 挂 stats 队列日批(30 天保留,崩溃残留代标失败收口)。
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

/** 台账保留期(行量口径:落账白名单约 400 行/日 × 30 天 ≈ 1.2 万行) */
export const JOB_RUN_RETENTION_DAYS = 30;

/** running 超 24h = worker 进程中断没落终态(挂死由健康页 1h 阈值更早暴露) */
const CRASHED_STALE_MS = 24 * 86_400_000;

const SUMMARY_MAX_CHARS = 4000;
const ERROR_MAX_CHARS = 4000;
/** duration_ms Int 上限(约 24.8 天;超长任务截断计) */
const DURATION_MS_MAX = 2_147_483_647;

/** 摘要打包(纯函数):处理器返回值原样入 Json;超长截为预览对象防单行膨胀;
 * 循环引用/BigInt 等不可序列化值降级为字符串说明。 */
export function packSummary(value: unknown): Prisma.InputJsonValue {
  if (typeof value === "string") {
    return value.length <= SUMMARY_MAX_CHARS
      ? { value }
      : { truncated: true, preview: value.slice(0, SUMMARY_MAX_CHARS) };
  }
  let text: string;
  try {
    text = JSON.stringify(value) ?? "null";
  } catch {
    return { unserializable: String(value) };
  }
  if (text.length <= SUMMARY_MAX_CHARS) {
    return typeof value === "object" && value !== null
      ? (value as Prisma.InputJsonValue)
      : { value: value as Prisma.InputJsonValue };
  }
  return { truncated: true, preview: text.slice(0, SUMMARY_MAX_CHARS) };
}

/** 连败数(纯函数):statuses 为该任务键最近终态、新→旧;数开头连续 failed,
 * 遇 success 归零,running 不参与(终态口径)。0 = 健康(读侧健康页判定共用)。 */
export function consecutiveFails(statusesNewestFirst: string[]): number {
  let n = 0;
  for (const s of statusesNewestFirst) {
    if (s === "failed") n += 1;
    else if (s === "success") break;
  }
  return n;
}

/** 错误信息截断(纯函数):错误栈可能巨长,截 4000 兜底 */
export function clipError(message: string): string {
  return message.slice(0, ERROR_MAX_CHARS);
}

export interface JobRunCreateInput {
  queue: string;
  jobName: string;
  trigger: "cron" | "manual";
}

/** 落 running 行(执行前);返回行 id 供终态回写 */
export async function createJobRun(input: JobRunCreateInput): Promise<bigint> {
  const row = await prisma.jobRun.create({
    data: {
      jobKey: `${input.queue}/${input.jobName}`,
      queue: input.queue,
      jobName: input.jobName,
      trigger: input.trigger,
      status: "running",
      startedAt: new Date(),
    },
    select: { id: true },
  });
  return row.id;
}

/** 终态回写:success 带汇总,failed 带 error;durationMs 由包装器用起跑时钟差算 */
export async function finishJobRun(
  id: bigint,
  status: "success" | "failed",
  meta: { summary?: unknown; error?: string; durationMs?: number } = {},
): Promise<void> {
  await prisma.jobRun.update({
    where: { id },
    data: {
      status,
      finishedAt: new Date(),
      ...(meta.durationMs === undefined
        ? {}
        : { durationMs: Math.min(Math.max(0, Math.round(meta.durationMs)), DURATION_MS_MAX) }),
      ...(meta.summary === undefined ? {} : { summary: packSummary(meta.summary) }),
      ...(meta.error === undefined ? {} : { error: clipError(meta.error) }),
    },
  });
}

export interface JobRunPurgeSummary {
  purged: number;
  crashed: number;
}

/** 保留期清理 + 崩溃残留代收口(running 超 24h 标 failed,不让僵尸行永久占用「进行中」) */
export async function purgeJobRuns(): Promise<JobRunPurgeSummary> {
  const cutoff = new Date(Date.now() - JOB_RUN_RETENTION_DAYS * 86_400_000);
  const purged = await prisma.jobRun.deleteMany({ where: { startedAt: { lt: cutoff } } });
  const crashed = await prisma.jobRun.updateMany({
    where: { status: "running", startedAt: { lt: new Date(Date.now() - CRASHED_STALE_MS) } },
    data: {
      status: "failed",
      finishedAt: new Date(),
      error: "进程中断:running 超 24h 未落终态,清理批代标失败",
    },
  });
  return { purged: purged.count, crashed: crashed.count };
}
