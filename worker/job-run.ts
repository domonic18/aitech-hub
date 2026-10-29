/**
 * 任务运行台账包装(验收二批③):在 worker/index 装配处统一包裹处理器——
 * 落账白名单内的周期/手动批任务先落 running 行再执行,终态回写(挂死 =
 * running 停留,健康页 1h 阈值即报;进程崩溃残留由日清批 24h 代收口)。
 * 台账是可观测性旁路:写失败只打事件,不拦任务本身。
 * 不入账:纯 tick 心跳(crawler/github/stats-flush/pay-sweep,每分钟噪音,工作
 * 单元在各自台账有账)与请求驱动单元任务(解读/转存/生图/SEO/分发/邮件,量级
 * 大且逐单元在业务表留痕)。embed-reconcile 属准心跳(96 次/日,多为空转),亦不落。
 */
import type { Job, Processor } from "bullmq";

import { createJobRun, finishJobRun } from "../src/lib/jobs/runlog";
import {
  COVER_JOB_TEMP_SWEEP,
  CRAWL_JOB_AI_BACKFILL,
  DB_BACKUP_JOB_RUN,
  DISCOVERY_JOB_BILI,
  DISCOVERY_JOB_HOTWORDS,
  INSIGHT_JOB_DAILY,
  INSIGHT_JOB_EMBED,
  INSIGHT_JOB_FETCH,
  PAY_JOB_DAILY_AUDIT,
  QUEUE_COVER_GEN,
  QUEUE_CRAWLER,
  QUEUE_DB_BACKUP,
  QUEUE_DISCOVERY,
  QUEUE_INSIGHT,
  QUEUE_MEDIA_AUDIT,
  QUEUE_PAY_RECONCILE,
  QUEUE_STATS,
  STATS_JOB_AGENT_PURGE,
  STATS_JOB_PURGE,
  STATS_JOB_RUN_PURGE,
  STATS_JOB_USAGE_PURGE,
} from "../src/lib/queue";

/** 落账白名单(queue/jobName,约 400 行/日;读侧标签映射 src/lib/jobs/runlog-admin 同批维护) */
const JOB_RUN_LOGGED: ReadonlySet<string> = new Set([
  `${QUEUE_INSIGHT}/${INSIGHT_JOB_FETCH}`,
  `${QUEUE_INSIGHT}/${INSIGHT_JOB_DAILY}`,
  `${QUEUE_INSIGHT}/${INSIGHT_JOB_EMBED}`,
  `${QUEUE_DISCOVERY}/${DISCOVERY_JOB_HOTWORDS}`,
  `${QUEUE_DISCOVERY}/${DISCOVERY_JOB_BILI}`,
  `${QUEUE_DB_BACKUP}/${DB_BACKUP_JOB_RUN}`,
  `${QUEUE_MEDIA_AUDIT}/audit`, // 媒体体检 job name 无常量(worker/schedules 内联 "audit")
  `${QUEUE_PAY_RECONCILE}/${PAY_JOB_DAILY_AUDIT}`,
  `${QUEUE_STATS}/${STATS_JOB_PURGE}`,
  `${QUEUE_STATS}/${STATS_JOB_USAGE_PURGE}`,
  `${QUEUE_STATS}/${STATS_JOB_AGENT_PURGE}`,
  `${QUEUE_STATS}/${STATS_JOB_RUN_PURGE}`,
  `${QUEUE_COVER_GEN}/${COVER_JOB_TEMP_SWEEP}`,
  `${QUEUE_CRAWLER}/${CRAWL_JOB_AI_BACKFILL}`,
]);

/** 手动触发判别:各触发入口 jobId 统一带 -manual-(insight/discovery 触发路由、
 * github-sync 手动、embed 对账/db-backup 运维脚本);BullMQ job scheduler 的
 * cron job id 为 repeat: 前缀,天然不撞。 */
export function jobRunTrigger(job: Pick<Job, "id">): "cron" | "manual" {
  return typeof job.id === "string" && job.id.includes("-manual-") ? "manual" : "cron";
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 终态回写兜底:失败只打事件(台账不能反过来影响任务结果) */
async function safeFinish(
  runId: bigint,
  status: "success" | "failed",
  meta: { summary?: unknown; error?: string; durationMs?: number },
): Promise<void> {
  try {
    await finishJobRun(runId, status, meta);
  } catch (e) {
    console.error(
      JSON.stringify({ event: "jobrun.finish_failed", runId: String(runId), error: errMsg(e) }),
    );
  }
}

export function withJobRunLog(queue: string, processor: Processor): Processor {
  return async (job) => {
    if (!JOB_RUN_LOGGED.has(`${queue}/${job.name}`)) return processor(job);
    const startedMs = Date.now();
    let runId: bigint | null = null;
    try {
      runId = await createJobRun({ queue, jobName: job.name, trigger: jobRunTrigger(job) });
    } catch (e) {
      console.error(
        JSON.stringify({ event: "jobrun.create_failed", queue, job: job.name, error: errMsg(e) }),
      );
    }
    let result: unknown;
    try {
      result = await processor(job);
    } catch (e) {
      if (runId !== null) {
        await safeFinish(runId, "failed", {
          error: errMsg(e),
          durationMs: Date.now() - startedMs,
        });
      }
      throw e;
    }
    if (runId !== null) {
      await safeFinish(runId, "success", { summary: result, durationMs: Date.now() - startedMs });
    }
    return result;
  };
}
