/**
 * worker 引导入口:处理器映射见 ./processors,周期调度注册见 ./schedules;
 * 本文件只做装配——起 Worker(队列级并发/锁参数)+ 挂调度 + checkpoint 表
 * 框架双保险 + 优雅停机。
 */
import { Worker, type Job } from "bullmq";

import { env } from "../src/lib/env";
import { bullConnection } from "../src/lib/queue";
import { ensureAgentCheckpointer } from "../src/lib/agent/checkpointer";
import { PROCESSORS } from "./processors";
import { QUEUE_WORKER_OPTS } from "./queue-opts";
import { withJobRunLog } from "./job-run";
import {
  scheduleAgentSessionPurge,
  scheduleAiBackfillTick,
  scheduleCoverTempSweep,
  scheduleCrawlerTick,
  scheduleDbBackup,
  scheduleXhsStateProbe,
  scheduleDiscovery,
  scheduleEmbedReconcile,
  scheduleGithubTick,
  scheduleInsight,
  scheduleJobRunPurge,
  scheduleMediaAudit,
  schedulePayReconcile,
  scheduleStatsFlush,
  scheduleUsageLogPurge,
  scheduleVisitLogPurge,
} from "./schedules";

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
    // 并发/锁参数按队列偏离,单源见 ./queue-opts(默认并发 2)
    const w = new Worker(name, withJobRunLog(name, PROCESSORS[name]), {
      connection,
      concurrency: 2,
      ...QUEUE_WORKER_OPTS[name],
    });
    w.on("failed", logFailed(name));
    workers.push(w);
  }

  await scheduleStatsFlush();
  await scheduleMediaAudit();
  // 牌价渠道(M56 批B):并入 crawler tick 频率调度——种子幂等入 crawl_source
  // (源管理可调周期),旧周批 BullMQ scheduler 就地摘除
  {
    const { syncPricingChannels } = await import("../src/lib/pricing/source-registry");
    await syncPricingChannels().catch((e: unknown) =>
      console.error(
        JSON.stringify({
          event: "pricing.source_sync_failed",
          error: e instanceof Error ? e.message : String(e),
        }),
      ),
    );
    const { getQueue } = await import("../src/lib/queue");
    const pq = getQueue("pricing");
    await pq.removeJobScheduler("crawl-official").catch(() => undefined);
    await pq.removeJobScheduler("sync-openrouter").catch(() => undefined);
    await pq.close().catch(() => undefined);
  }
  await scheduleCoverTempSweep();
  await scheduleVisitLogPurge();
  await scheduleUsageLogPurge();
  await scheduleAgentSessionPurge();
  await scheduleJobRunPurge();
  await scheduleDbBackup();
  await scheduleXhsStateProbe();
  await scheduleEmbedReconcile();
  await schedulePayReconcile();
  await scheduleCrawlerTick();
  await scheduleGithubTick();
  await scheduleAiBackfillTick();
  await scheduleDiscovery();
  await scheduleInsight();

  // checkpoint 表框架双保险(web 侧 getAgentGraph 懒加载为主;失败不拦 boot,
  // 首个 agent 任务内部 ensure 重试)
  try {
    await ensureAgentCheckpointer();
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "agent.checkpoint_setup_deferred",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  }

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
