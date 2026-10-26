/**
 * worker 引导入口:处理器映射见 ./processors,周期调度注册见 ./schedules;
 * 本文件只做装配——起 Worker(队列级并发/锁参数)+ 挂调度 + checkpoint 表
 * 框架双保险 + 优雅停机。
 */
import { Worker, type Job } from "bullmq";

import { env } from "../src/lib/env";
import {
  QUEUE_COVER_GEN,
  QUEUE_DB_BACKUP,
  QUEUE_DISCOVERY,
  QUEUE_DISTRIBUTE,
  QUEUE_ILLUSTRATION_STUDIO,
  QUEUE_INSIGHT,
  QUEUE_INTERPRETER,
  QUEUE_MEDIA_TRANSFER,
  QUEUE_PAY_RECONCILE,
  QUEUE_SEO_BATCH,
  QUEUE_SUMMARIZER,
  bullConnection,
} from "../src/lib/queue";
import { ensureAgentCheckpointer } from "../src/lib/agent/checkpointer";
import { PROCESSORS } from "./processors";
import { withJobRunLog } from "./job-run";
import {
  scheduleAgentSessionPurge,
  scheduleAiBackfillTick,
  scheduleCoverTempSweep,
  scheduleCrawlerTick,
  scheduleDbBackup,
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
    // transfer 抓外链、interpreter 下载+抽轨+云端 AI 调用、summarizer 抓原文+LLM、
    // cover-gen 云厂商生图(10-30s+)耗时长,放宽锁续期;interpreter/seo-batch 并发钉 1
    // (interpreter:ffmpeg 抽轨 CPU 峰值 arch/02 §3.2;seo-batch:逐篇 LLM 防打爆模型速率);
    // distribute 并发 1(微信接口频控全局串行)+ 锁 900s 覆盖单批 30 篇 × ~15s
    const opts =
      name === QUEUE_MEDIA_TRANSFER || name === QUEUE_SUMMARIZER || name === QUEUE_COVER_GEN
        ? { lockDuration: 300_000 }
        : name === QUEUE_INTERPRETER || name === QUEUE_SEO_BATCH
          ? { concurrency: 1, lockDuration: 600_000 }
          : name === QUEUE_DISTRIBUTE
            ? // 批D:wechat 沿用历史队列(在途 job 兼容);新渠道走 distributeQueueFor
              // 子队列,届时在此按渠道各建 worker(同并发 1 语义),互不队头阻塞
              { concurrency: 1, lockDuration: 900_000 }
            : name === QUEUE_DB_BACKUP
              ? { concurrency: 1, lockDuration: 600_000 }
              : name === QUEUE_PAY_RECONCILE
                ? { concurrency: 1 } // 查单/关单/补发按单串行,防双拍交错
                : name === QUEUE_DISCOVERY
                  ? { concurrency: 1, lockDuration: 900_000 } // B站风控纪律全局串行;双窗全词 5-10min
                  : name === QUEUE_INSIGHT
                    ? { concurrency: 1, lockDuration: 600_000 } // 日批 LLM 分钟级;并发 1 防双拍交错归簇
                    : name === QUEUE_ILLUSTRATION_STUDIO
                      ? { concurrency: 1, lockDuration: 600_000 } // 拆层 ~75s+逐层转存;并发 1 防打爆单绑定模型
                      : {};
    const w = new Worker(name, withJobRunLog(name, PROCESSORS[name]), {
      connection,
      concurrency: 2,
      ...opts,
    });
    w.on("failed", logFailed(name));
    workers.push(w);
  }

  await scheduleStatsFlush();
  await scheduleMediaAudit();
  await scheduleCoverTempSweep();
  await scheduleVisitLogPurge();
  await scheduleUsageLogPurge();
  await scheduleAgentSessionPurge();
  await scheduleJobRunPurge();
  await scheduleDbBackup();
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
