/**
 * worker 引导入口:处理器映射见 ./processors,周期调度注册见 ./schedules;
 * 本文件只做装配——起 Worker(队列级并发/锁参数)+ 挂调度 + checkpoint 表
 * 框架双保险 + 优雅停机。
 */
import { Worker, type Job } from "bullmq";

import { env } from "../src/lib/env";
import { logError, logInfo, logWarn } from "../src/lib/logger";
import { bullConnection } from "../src/lib/queue";
import { ensureAgentCheckpointer } from "../src/lib/agent/checkpointer";
import { ensureUsdCnyRate } from "../src/lib/leaderboard/fx";
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
  scheduleLeaderboardFxRefresh,
  scheduleMediaAudit,
  schedulePayReconcile,
  scheduleStatsFlush,
  scheduleUsageLogPurge,
  scheduleVisitLogPurge,
  scheduleWechatMpPurge,
} from "./schedules";

function logFailed(queue: string): (job: Job | undefined, err: Error) => void {
  return (job, err) => {
    logError("worker.job.failed", { queue, jobId: job?.id, error: err.message });
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
    // BullMQ 的连接/内部错误以 'error' 事件抛出,没有监听器就是 uncaughtException
    // —— 一次 Redis 抖动会直接带走整个 worker 进程(全部队列一起停)
    w.on("error", (e) => logError("worker.error", { queue: name, error: e.message }));
    workers.push(w);
  }

  // 信号处理器必须早于调度注册挂上:此前挂在 main() 末尾,发版时若还停在
  // 调度注册阶段,信号走 Node 默认终止,BullMQ 锁只能等过期,期间任务 stalled
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logInfo("worker.shutdown", { signal });
    await Promise.all(workers.map((w) => w.close()));
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await scheduleStatsFlush();
  await scheduleMediaAudit();
  // 牌价渠道(M56 批B):并入 crawler tick 频率调度——种子幂等入 crawl_source
  // (源管理可调周期),旧周批 BullMQ scheduler 就地摘除
  {
    const { syncPricingChannels } = await import("../src/lib/pricing/source-registry");
    await syncPricingChannels().catch((e: unknown) =>
      logError("pricing.source_sync_failed", { error: e instanceof Error ? e.message : String(e) }),
    );
    const { getQueue } = await import("../src/lib/queue");
    const pq = getQueue("pricing");
    await pq.removeJobScheduler("crawl-official").catch(() => undefined);
    await pq.removeJobScheduler("sync-openrouter").catch(() => undefined);
    await pq.close().catch(() => undefined);
  }
  // 厂商动态渠道(M58 批②):同牌价——种子幂等入 crawl_source,走 crawler tick
  {
    const { syncVendorChannels } = await import("../src/lib/insight/vendor/crawl");
    await syncVendorChannels().catch((e: unknown) =>
      logError("insight.vendor_source_sync_failed", { error: e }),
    );
  }
  // 榜单渠道(M58 批③):种子幂等入 crawl_source(日频),走 crawler tick
  {
    const { syncLeaderboardChannels } = await import("../src/lib/leaderboard/crawl");
    await syncLeaderboardChannels().catch((e: unknown) =>
      logError("leaderboard.source_sync_failed", { error: e }),
    );
  }
  // 社区需求语料(M58 批④):种子幂等入 crawl_source(HN/V2EX 时频,其余日频)
  {
    const { syncCommunityChannels } = await import("../src/lib/insight/community/crawl");
    await syncCommunityChannels().catch((e: unknown) =>
      logError("insight.community_source_sync_failed", { error: e }),
    );
  }
  await scheduleCoverTempSweep();
  await scheduleVisitLogPurge();
  await scheduleWechatMpPurge();
  await scheduleUsageLogPurge();
  await scheduleAgentSessionPurge();
  await scheduleJobRunPurge();
  await scheduleDbBackup();
  await scheduleXhsStateProbe();
  await scheduleEmbedReconcile();
  await schedulePayReconcile();
  await scheduleCrawlerTick();
  await scheduleLeaderboardFxRefresh();
  // 汇率启动补偿(M63 后续 2026-10-31):定时采集在 04:43,首次上线/换版的 worker
  // 在此之前没有汇率行 —— 页面会拿默认 7.2 折算到下一个凌晨。不 await:外部 HTTP
  // 最多 15s,不该挡 worker 就绪;定时任务仍是兜底。ensure 内部已吞错,这里再兜
  // 一层 catch:不 await 的 promise reject 就是 unhandledRejection(进程退出)。
  void ensureUsdCnyRate().catch((e: unknown) =>
    logWarn("leaderboard.fx_boot_failed", {
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  await scheduleGithubTick();
  await scheduleAiBackfillTick();
  await scheduleDiscovery();
  await scheduleInsight();

  // checkpoint 表框架双保险(web 侧 getAgentGraph 懒加载为主;失败不拦 boot,
  // 首个 agent 任务内部 ensure 重试)
  try {
    await ensureAgentCheckpointer();
  } catch (e) {
    logWarn("agent.checkpoint_setup_deferred", { error: e });
  }

  logInfo("worker.started", {
    queues: Object.keys(PROCESSORS),
    redis: env.REDIS_URL.replace(/\/\/.*@/, "//***@"),
  });
}

// 启动失败必须显式落日志并退出:裸 void main() 让任一注册步骤的 reject 变成
// unhandledRejection,Node 22 直接抛栈退出,容器里只看到一段没有事件名的崩溃
main().catch((e: unknown) => {
  logError("worker.boot_failed", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
