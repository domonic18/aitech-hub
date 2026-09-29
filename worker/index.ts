import { Worker, type Processor, type Job } from "bullmq";

import { env } from "../src/lib/env";
import { QUEUE_MEDIA_PROCESS, QUEUE_STATS, bullConnection, getQueue } from "../src/lib/queue";
import { flushStatsBuffer } from "../src/lib/stats/service";

/** 各队列处理器;未到里程碑的队列保持显式失败,避免静默吞任务 */
const PROCESSORS: Record<string, Processor> = {
  [QUEUE_MEDIA_PROCESS]: async (job) => {
    // media 管线(sharp WebP/缩略图/宽高回填)随 M5 媒体库落地
    throw new Error(`queue ${QUEUE_MEDIA_PROCESS} 的处理器尚未实现(job ${job.id},M5 交付)`);
  },
  [QUEUE_STATS]: async () => {
    const summary = await flushStatsBuffer();
    if (summary.keysFlushed > 0) {
      console.log(JSON.stringify({ event: "stats.flush", ...summary }));
    }
    return summary;
  },
};

/** 统计 flush 的调度(BullMQ v6 job scheduler;upsert 幂等,同 id 不重复建) */
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
    const w = new Worker(name, PROCESSORS[name], { connection, concurrency: 2 });
    w.on("failed", logFailed(name));
    workers.push(w);
  }

  await scheduleStatsFlush();

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
