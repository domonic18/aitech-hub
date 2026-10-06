import { Worker, type Processor, type Job } from "bullmq";

import { env } from "../src/lib/env";
import { SITE_TZ } from "../src/lib/datetime";
import {
  CRAWL_JOB_AI_BACKFILL,
  CRAWL_JOB_TICK,
  CRAWL_JOB_VIDEO,
  GITHUB_JOB_TICK,
  MEDIA_AUDIT_CRON,
  QUEUE_COVER_GEN,
  QUEUE_CRAWLER,
  QUEUE_GITHUB,
  QUEUE_INTERPRETER,
  QUEUE_MEDIA_AUDIT,
  QUEUE_MEDIA_PROCESS,
  QUEUE_MEDIA_TRANSFER,
  QUEUE_STATS,
  QUEUE_SEO_BATCH,
  QUEUE_SUMMARIZER,
  STATS_JOB_FLUSH,
  STATS_JOB_PURGE,
  STATS_JOB_USAGE_PURGE,
  USAGE_LOG_PURGE_CRON,
  VISIT_LOG_PURGE_CRON,
  bullConnection,
  getQueue,
} from "../src/lib/queue";
import { flushStatsBuffer } from "../src/lib/stats/flush";
import { purgeVisitLogs } from "../src/lib/stats/service";
import { purgeAiUsageOlderThan } from "../src/lib/ai/usage-log";
import { syncDueRepos, syncGithubRepo } from "../src/lib/github/sync";
import { backfillAiPending } from "../src/lib/telegram/ai-backfill";
import { crawlDueSources, crawlSource } from "../src/lib/telegram/ingest";
import { crawlVideoAccount, enqueueDueVideoAccounts } from "../src/lib/telegram/ingest-video";
import { coverGenJob, type CoverGenJobData } from "../src/lib/ai/cover-generate";
import { seoBatchJob, type SeoBatchJobData } from "../src/lib/ai/seo-batch";
import { interpretVideoJob, type InterpretJobData } from "../src/lib/telegram/interpret-video";
import { summarizeTextJob, type SummarizeJobData } from "../src/lib/telegram/summarize-text";
import { processMediaJob, transferMediaJob } from "./media";
import { runAudit } from "../src/lib/media/audit";

/** 各队列处理器;未到里程碑的队列保持显式失败,避免静默吞任务 */
const PROCESSORS: Record<string, Processor> = {
  [QUEUE_MEDIA_PROCESS]: (job) => processMediaJob(job),
  [QUEUE_MEDIA_TRANSFER]: (job) => transferMediaJob(job),
  [QUEUE_MEDIA_AUDIT]: async () => {
    const summary = await runAudit();
    console.log(JSON.stringify({ event: "media.audit", ...summary }));
    return summary;
  },
  [QUEUE_STATS]: async (job) => {
    // 访问明细 7 天保留期清理(M10 批⑥;与 flush 同队列按 job.name 分流)
    if (job.name === STATS_JOB_PURGE) {
      const removed = await purgeVisitLogs();
      if (removed > 0) {
        console.log(JSON.stringify({ event: "stats.visit_log.purge", removed }));
      }
      return { removed };
    }
    // AI 用量台账 90 天保留期清理(M14 批⑦;与手动清理同口径 usage-log.ts)
    if (job.name === STATS_JOB_USAGE_PURGE) {
      const removed = await purgeAiUsageOlderThan();
      if (removed > 0) {
        console.log(JSON.stringify({ event: "ai_usage.purge", removed }));
      }
      return { removed };
    }
    const summary = await flushStatsBuffer();
    if (summary.keysFlushed > 0) {
      console.log(JSON.stringify({ event: "stats.flush", ...summary }));
    }
    return summary;
  },
  // tick(每分钟)、crawl(单渠道)、crawl-video(单博主)、ai-backfill(5min)共用队列,按 job.name 分流
  [QUEUE_CRAWLER]: async (job) => {
    if (job.name === CRAWL_JOB_TICK) {
      const summary = await crawlDueSources();
      // 同拍扫视频博主(平台行不调度,social_account 才是调度主体;M8)
      const video = await enqueueDueVideoAccounts();
      const due = summary.due + video.due;
      if (due > 0) {
        console.log(JSON.stringify({ event: "crawler.tick", ...summary, videoDue: video.due }));
      }
      return { ...summary, videoDue: video.due };
    }
    if (job.name === CRAWL_JOB_AI_BACKFILL) {
      // AI 存量补扫(M12 批③):未解读条目分流入 interpret/summarize 队列
      const summary = await backfillAiPending();
      if (summary.video > 0 || summary.text > 0) {
        console.log(JSON.stringify({ event: "ai.backfill", ...summary }));
      }
      return summary;
    }
    if (job.name === CRAWL_JOB_VIDEO) {
      // data.backfill 由手动回填路由置真(批⑧);旧 worker 收到退化为常规增量(良性)
      const summary = await crawlVideoAccount(Number(job.data.accountId), {
        backfill: job.data.backfill === true,
      });
      console.log(JSON.stringify({ event: "crawler.video.crawl", ...summary }));
      return summary;
    }
    const summary = await crawlSource(Number(job.data.sourceId));
    console.log(JSON.stringify({ event: "crawler.crawl", ...summary }));
    return summary;
  },
  // 视频解读(M9):下载→抽轨→ASR→LLM;分支语义在 interpretVideoJob 内收敛
  [QUEUE_INTERPRETER]: (job) => interpretVideoJob(job.data as InterpretJobData),
  // 文字资讯轻解读(M12 批③):中心思想 + 关键词,LLM 网络调用为主(默认并发 2)
  [QUEUE_SUMMARIZER]: (job) => summarizeTextJob(job.data as SummarizeJobData),
  // 文生图封面(M14 批⑥):云厂商生图 10-30s,按张计费不自动重试(attempts=1 入队侧钉)
  [QUEUE_COVER_GEN]: (job) => coverGenJob(job.data as CoverGenJobData),
  // 批量 SEO 补全(M16 问题8,仅补空缺):单批次 job 顺序逐篇 LLM 调用,进度逐篇上报
  [QUEUE_SEO_BATCH]: (job) =>
    seoBatchJob(job.data as SeoBatchJobData, (p) => job.updateProgress(p)),
  // GitHub 项目同步(二期③/M11):tick(5min)扫到期白名单仓逐仓入队;sync 为缺省路径
  [QUEUE_GITHUB]: async (job) => {
    if (job.name === GITHUB_JOB_TICK) {
      const summary = await syncDueRepos();
      if (summary.due > 0) {
        console.log(JSON.stringify({ event: "github.tick", ...summary }));
      }
      return summary;
    }
    const summary = await syncGithubRepo(Number(job.data.repoId));
    console.log(JSON.stringify({ event: "github.sync", ...summary }));
    return summary;
  },
};

/** 周期调度(BullMQ v6 job scheduler;upsert 幂等,同 id 不重复建) */
const STATS_FLUSH_EVERY_MS = 60_000;

async function scheduleStatsFlush(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "stats-flush",
    { every: STATS_FLUSH_EVERY_MS },
    {
      name: STATS_JOB_FLUSH,
      data: {},
      opts: { removeOnComplete: 100 },
    },
  );
}

async function scheduleMediaAudit(): Promise<void> {
  const queue = getQueue(QUEUE_MEDIA_AUDIT);
  await queue.upsertJobScheduler(
    "media-audit",
    // tz 显式声明:缺省走进程系统时区,靠镜像 ENV TZ 兜底属侥幸(2026-10-05 review 定级)
    { pattern: MEDIA_AUDIT_CRON, tz: SITE_TZ },
    {
      name: "audit",
      data: {},
      opts: { removeOnComplete: 7 },
    },
  );
}

/** 访问明细清理:每日 04:14 清 7 天前行(M10 批⑥) */
async function scheduleVisitLogPurge(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "visit-log-purge",
    { pattern: VISIT_LOG_PURGE_CRON, tz: SITE_TZ },
    {
      name: STATS_JOB_PURGE,
      data: {},
      opts: { removeOnComplete: 7 },
    },
  );
}

/** AI 用量台账清理:每日 04:52 清 90 天前行(M14 批⑦) */
async function scheduleUsageLogPurge(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "usage-log-purge",
    { pattern: USAGE_LOG_PURGE_CRON, tz: SITE_TZ },
    {
      name: STATS_JOB_USAGE_PURGE,
      data: {},
      opts: { removeOnComplete: 7 },
    },
  );
}

/** 采集 tick:每分钟扫描到期来源逐源入队(渠道频率差异由 crawl_source.next_run_at 表达) */
const CRAWLER_TICK_EVERY_MS = 60_000;

async function scheduleCrawlerTick(): Promise<void> {
  const queue = getQueue(QUEUE_CRAWLER);
  await queue.upsertJobScheduler(
    "crawler-tick",
    { every: CRAWLER_TICK_EVERY_MS },
    {
      name: CRAWL_JOB_TICK,
      data: {},
      opts: { removeOnComplete: 50 },
    },
  );
}

/** GitHub 同步 tick:每 5 分钟扫到期白名单仓(逐仓间隔由 github_repo.next_sync_at 表达;
 * 5min 粒度相对 600s ISR 前台窗口不可见) */
const GITHUB_TICK_EVERY_MS = 300_000;

async function scheduleGithubTick(): Promise<void> {
  const queue = getQueue(QUEUE_GITHUB);
  await queue.upsertJobScheduler(
    "github-tick",
    { every: GITHUB_TICK_EVERY_MS },
    {
      name: GITHUB_JOB_TICK,
      data: {},
      opts: { removeOnComplete: 50 },
    },
  );
}

/** AI 存量补扫 tick(M12 批③):每 5 分钟扫未解读可见条分流入 interpret/summarize;
 * 就绪检查与每类 5 条上限在 backfillAiPending 内收敛 */
const AI_BACKFILL_TICK_EVERY_MS = 300_000;

async function scheduleAiBackfillTick(): Promise<void> {
  const queue = getQueue(QUEUE_CRAWLER);
  await queue.upsertJobScheduler(
    "ai-backfill-tick",
    { every: AI_BACKFILL_TICK_EVERY_MS },
    {
      name: CRAWL_JOB_AI_BACKFILL,
      data: {},
      opts: { removeOnComplete: 50 },
    },
  );
}

function logFailed(queue: string): (job: Job | undefined, err: Error) => void {
  return (job, err) => {
    console.error(
      JSON.stringify({ event: "worker.job.failed", queue, jobId: job?.id, error: err.message }),
    );
  };
}

async function main(): Promise<void> {
  const connection = bullConnection();
  const workers: Array<Worker> = [];

  for (const name of Object.keys(PROCESSORS)) {
    // transfer 抓外链、interpreter 下载+抽轨+云端 AI 调用、summarizer 抓原文+LLM、
    // cover-gen 云厂商生图(10-30s+)耗时长,放宽锁续期;interpreter/seo-batch 并发钉 1
    // (interpreter:ffmpeg 抽轨 CPU 峰值 arch/02 §3.2;seo-batch:逐篇 LLM 防打爆模型速率)
    const opts =
      name === QUEUE_MEDIA_TRANSFER || name === QUEUE_SUMMARIZER || name === QUEUE_COVER_GEN
        ? { lockDuration: 300_000 }
        : name === QUEUE_INTERPRETER || name === QUEUE_SEO_BATCH
          ? { concurrency: 1, lockDuration: 600_000 }
          : {};
    const w = new Worker(name, PROCESSORS[name], { connection, concurrency: 2, ...opts });
    w.on("failed", logFailed(name));
    workers.push(w);
  }

  await scheduleStatsFlush();
  await scheduleMediaAudit();
  await scheduleVisitLogPurge();
  await scheduleUsageLogPurge();
  await scheduleCrawlerTick();
  await scheduleGithubTick();
  await scheduleAiBackfillTick();

  console.log(
    JSON.stringify({
      event: "worker.started",
      queues: Object.keys(PROCESSORS),
      redis: env.REDIS_URL.replace(/\/\/.*@/, "//***@"),
    }),
  );

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(JSON.stringify({ event: "worker.shutdown", signal }));
    await Promise.all(workers.map((w) => w.close()));
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
