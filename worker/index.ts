import { Worker, type Processor, type Job } from "bullmq";

import { env } from "../src/lib/env";
import {
  MEDIA_AUDIT_CRON,
  QUEUE_CRAWLER,
  QUEUE_MEDIA_AUDIT,
  QUEUE_MEDIA_PROCESS,
  QUEUE_MEDIA_TRANSFER,
  QUEUE_STATS,
  bullConnection,
  getQueue,
} from "../src/lib/queue";
import { flushStatsBuffer } from "../src/lib/stats/service";
import { crawlDueSources, crawlSource } from "../src/lib/telegram/ingest";
import { crawlVideoAccount, enqueueDueVideoAccounts } from "../src/lib/telegram/ingest-video";
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
  [QUEUE_STATS]: async () => {
    const summary = await flushStatsBuffer();
    if (summary.keysFlushed > 0) {
      console.log(JSON.stringify({ event: "stats.flush", ...summary }));
    }
    return summary;
  },
  // tick(每分钟)、crawl(单渠道)、crawl-video(单博主)共用队列,按 job.name 分流
  [QUEUE_CRAWLER]: async (job) => {
    if (job.name === "tick") {
      const summary = await crawlDueSources();
      // 同拍扫视频博主(平台行不调度,social_account 才是调度主体;M8)
      const video = await enqueueDueVideoAccounts();
      const due = summary.due + video.due;
      if (due > 0) {
        console.log(JSON.stringify({ event: "crawler.tick", ...summary, videoDue: video.due }));
      }
      return { ...summary, videoDue: video.due };
    }
    if (job.name === "crawl-video") {
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
};

/** 周期调度(BullMQ v6 job scheduler;upsert 幂等,同 id 不重复建) */
const STATS_FLUSH_EVERY_MS = 60_000;

async function scheduleStatsFlush(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "stats-flush",
    { every: STATS_FLUSH_EVERY_MS },
    {
      name: "flush",
      data: {},
      opts: { removeOnComplete: 100 },
    },
  );
}

async function scheduleMediaAudit(): Promise<void> {
  const queue = getQueue(QUEUE_MEDIA_AUDIT);
  await queue.upsertJobScheduler(
    "media-audit",
    { pattern: MEDIA_AUDIT_CRON },
    {
      name: "audit",
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
      name: "tick",
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
    // transfer 抓外链耗时长,放宽锁续期;其余队列默认值即可
    const opts = name === QUEUE_MEDIA_TRANSFER ? { lockDuration: 300_000 } : {};
    const w = new Worker(name, PROCESSORS[name], { connection, concurrency: 2, ...opts });
    w.on("failed", logFailed(name));
    workers.push(w);
  }

  await scheduleStatsFlush();
  await scheduleMediaAudit();
  await scheduleCrawlerTick();

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
