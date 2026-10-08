import { Worker, type Processor, type Job } from "bullmq";

import { env } from "../src/lib/env";
import { SITE_TZ } from "../src/lib/datetime";
import {
  AGENT_SESSION_PURGE_CRON,
  CRAWL_JOB_AI_BACKFILL,
  DB_BACKUP_CRON,
  DB_BACKUP_JOB_RUN,
  CRAWL_JOB_TICK,
  CRAWL_JOB_VIDEO,
  DISTRIBUTE_JOB_WECHAT_BATCH,
  GITHUB_JOB_TICK,
  MEDIA_AUDIT_CRON,
  QUEUE_COVER_GEN,
  QUEUE_CRAWLER,
  QUEUE_DISTRIBUTE,
  QUEUE_DB_BACKUP,
  QUEUE_GITHUB,
  QUEUE_INTERPRETER,
  QUEUE_MEDIA_AUDIT,
  QUEUE_MEDIA_PROCESS,
  QUEUE_MEDIA_TRANSFER,
  QUEUE_STATS,
  QUEUE_SEO_BATCH,
  QUEUE_SUMMARIZER,
  STATS_JOB_AGENT_PURGE,
  STATS_JOB_FLUSH,
  STATS_JOB_PURGE,
  STATS_JOB_USAGE_PURGE,
  USAGE_LOG_PURGE_CRON,
  VISIT_LOG_PURGE_CRON,
  bullConnection,
  getQueue,
} from "../src/lib/queue";
import { flushStatsBuffer } from "../src/lib/stats/flush";
import { purgeSearchLogs, purgeVisitLogs } from "../src/lib/stats/service";
import { purgeAiUsageOlderThan } from "../src/lib/ai/usage-log";
import { purgeAgentSessions, purgeExpiredGuestThreads } from "../src/lib/agent/purge";
import { ensureAgentCheckpointer } from "../src/lib/agent/checkpointer";
import { syncDueRepos, syncGithubRepo } from "../src/lib/github/sync";
import { backfillAiPending } from "../src/lib/telegram/ai-backfill";
import { crawlDueSources, crawlSource } from "../src/lib/telegram/ingest";
import { crawlVideoAccount, enqueueDueVideoAccounts } from "../src/lib/telegram/ingest-video";
import { coverGenJob, type CoverGenJobData } from "../src/lib/ai/cover-generate";
import { seoBatchJob, type SeoBatchJobData } from "../src/lib/ai/seo-batch";
import { type WechatBatchJobData, type WechatSyncJobData } from "../src/lib/distribute/wechat-sync";
import { wechatBatchJob, wechatSyncJob } from "../src/lib/distribute/wechat-sync-run";
import { interpretVideoJob, type InterpretJobData } from "../src/lib/telegram/interpret-video";
import { summarizeTextJob, type SummarizeJobData } from "../src/lib/telegram/summarize-text";
import { processMediaJob, transferMediaJob } from "./media";
import { runAudit } from "../src/lib/media/audit";
import { dbBackupJob } from "../src/lib/backup/db-backup";

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
    // 明细保留期清理(M10 批⑥ 访问 7 天;2026-10-06 搜索词 180 天;与 flush 同队列按 job.name 分流)
    if (job.name === STATS_JOB_PURGE) {
      const visitRemoved = await purgeVisitLogs();
      if (visitRemoved > 0) {
        console.log(JSON.stringify({ event: "stats.visit_log.purge", removed: visitRemoved }));
      }
      const searchRemoved = await purgeSearchLogs();
      if (searchRemoved > 0) {
        console.log(JSON.stringify({ event: "stats.search_log.purge", removed: searchRemoved }));
      }
      return { removed: visitRemoved + searchRemoved };
    }
    // AI 用量台账 90 天保留期清理(M14 批⑦;与手动清理同口径 usage-log.ts)
    if (job.name === STATS_JOB_USAGE_PURGE) {
      const removed = await purgeAiUsageOlderThan();
      if (removed > 0) {
        console.log(JSON.stringify({ event: "ai_usage.purge", removed }));
      }
      return { removed };
    }
    // Drawer 会话清退(K2.5 member 30 天 + K2.6 游客 TTL 键消失;checkpoint 残留由下轮再扫)
    if (job.name === STATS_JOB_AGENT_PURGE) {
      const removed = await purgeAgentSessions();
      if (removed > 0) {
        console.log(JSON.stringify({ event: "agent.session.purge", removed }));
      }
      const guestRemoved = await purgeExpiredGuestThreads();
      if (guestRemoved > 0) {
        console.log(JSON.stringify({ event: "agent.guest_thread.purge", removed: guestRemoved }));
      }
      return { removed, guestRemoved };
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
  // 数据库每日备份(M19 批②):pg_dump -Fc → 备份桶;结果事件在 job 内落日志
  [QUEUE_DB_BACKUP]: async () => {
    const r = await dbBackupJob();
    console.log(
      JSON.stringify({
        event: "db.backup_job_done",
        key: r.key,
        sizeBytes: r.sizeBytes,
        ms: r.durationMs,
      }),
    );
    return r;
  },
  // 公众号草稿同步(M17):wechat-sync 单篇为缺省路径(一键/发布自动共用);wechat-batch 批量
  [QUEUE_DISTRIBUTE]: async (job) => {
    if (job.name === DISTRIBUTE_JOB_WECHAT_BATCH) {
      const progress = await wechatBatchJob(job.data as WechatBatchJobData, (p) =>
        job.updateProgress(p),
      );
      console.log(JSON.stringify({ event: "wechat.batch_result", ...progress }));
      return progress;
    }
    const r = await wechatSyncJob(job.data as WechatSyncJobData);
    console.log(
      JSON.stringify({
        event: "wechat.sync_result",
        postId: r.postId,
        ok: r.ok,
        mediaId: r.mediaId ?? null,
      }),
    );
    return r;
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

/** Drawer 会话清退:每日 04:33 清 30 天前留档(K2.5;行+checkpoint 同删) */
async function scheduleAgentSessionPurge(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "agent-session-purge",
    { pattern: AGENT_SESSION_PURGE_CRON, tz: SITE_TZ },
    {
      name: STATS_JOB_AGENT_PURGE,
      data: {},
      opts: { removeOnComplete: 7 },
    },
  );
}

/** 数据库每日备份:03:23 pg_dump → 备份桶(M19 批②,M6 异机存放落地) */
async function scheduleDbBackup(): Promise<void> {
  const queue = getQueue(QUEUE_DB_BACKUP);
  await queue.upsertJobScheduler(
    "db-backup",
    { pattern: DB_BACKUP_CRON, tz: SITE_TZ },
    {
      name: DB_BACKUP_JOB_RUN,
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
    // (interpreter:ffmpeg 抽轨 CPU 峰值 arch/02 §3.2;seo-batch:逐篇 LLM 防打爆模型速率);
    // distribute 并发 1(微信接口频控全局串行)+ 锁 900s 覆盖单批 30 篇 × ~15s
    const opts =
      name === QUEUE_MEDIA_TRANSFER || name === QUEUE_SUMMARIZER || name === QUEUE_COVER_GEN
        ? { lockDuration: 300_000 }
        : name === QUEUE_INTERPRETER || name === QUEUE_SEO_BATCH
          ? { concurrency: 1, lockDuration: 600_000 }
          : name === QUEUE_DISTRIBUTE
            ? { concurrency: 1, lockDuration: 900_000 }
            : name === QUEUE_DB_BACKUP
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
  await scheduleAgentSessionPurge();
  await scheduleDbBackup();
  await scheduleCrawlerTick();
  await scheduleGithubTick();
  await scheduleAiBackfillTick();

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
