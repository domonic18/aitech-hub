/**
 * 周期调度注册(worker/index 引导消费):BullMQ v6 job scheduler,upsert 幂等
 * 同 id 不重复建。job name 契约唯一真相源在 lib/queue;cron 常量唯一真相源在
 * lib/collect/schedules(采集计划登记表,queue.ts re-export),本模块只
 * 做「注册什么、何时触发」的表达。
 */
import {
  AGENT_SESSION_PURGE_CRON,
  COVER_JOB_TEMP_SWEEP,
  COVER_TEMP_SWEEP_CRON,
  CRAWL_JOB_AI_BACKFILL,
  CRAWL_JOB_TICK,
  DB_BACKUP_CRON,
  DB_BACKUP_JOB_RUN,
  DISCOVERY_BILI_CRON,
  DISCOVERY_HOTWORDS_CRON,
  DISCOVERY_JOB_BILI,
  DISCOVERY_JOB_HOTWORDS,
  EMBED_JOB_RECONCILE,
  EMBED_RECONCILE_CRON,
  GITHUB_JOB_TICK,
  INSIGHT_DAILY_CRON,
  INSIGHT_EMBED_CRON,
  INSIGHT_FETCH_CRON,
  INSIGHT_JOB_DAILY,
  INSIGHT_JOB_EMBED,
  INSIGHT_JOB_FETCH,
  JOB_RUN_PURGE_CRON,
  QUEUE_INSIGHT,
  MEDIA_AUDIT_CRON,
  PRICING_SYNC_CRON,
  PAY_DAILY_AUDIT_CRON,
  PAY_JOB_DAILY_AUDIT,
  PAY_JOB_SWEEP,
  QUEUE_COVER_GEN,
  PRICING_JOB_SYNC,
  QUEUE_CRAWLER,
  QUEUE_DB_BACKUP,
  QUEUE_DISCOVERY,
  QUEUE_EMBED,
  QUEUE_GITHUB,
  QUEUE_MEDIA_AUDIT,
  QUEUE_PAY_RECONCILE,
  QUEUE_PRICING,
  QUEUE_STATS,
  STATS_JOB_AGENT_PURGE,
  STATS_JOB_FLUSH,
  STATS_JOB_PURGE,
  STATS_JOB_RUN_PURGE,
  STATS_JOB_USAGE_PURGE,
  USAGE_LOG_PURGE_CRON,
  VISIT_LOG_PURGE_CRON,
  getQueue,
  QUEUE_DISTRIBUTE,
  DISTRIBUTE_JOB_XHS_STATE_PROBE,
} from "../src/lib/queue";
import { SITE_TZ } from "../src/lib/datetime";

const STATS_FLUSH_EVERY_MS = 60_000;

/** 调度任务统一 opts:成功保留条数沿用各任务原值;失败一律保留 50 条——BullMQ 缺省
 * failed 永不清理,高频调度(如 stats-flush 60s/embed 15min)持续失败会在 Redis 堆
 * failed job(含栈与返回值)构成慢泄漏(M48 批A④) */
function schedulerOpts(removeOnComplete: number) {
  return { removeOnComplete, removeOnFail: 50 };
}

export async function scheduleStatsFlush(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "stats-flush",
    { every: STATS_FLUSH_EVERY_MS },
    {
      name: STATS_JOB_FLUSH,
      data: {},
      opts: schedulerOpts(100),
    },
  );
}

export async function scheduleMediaAudit(): Promise<void> {
  const queue = getQueue(QUEUE_MEDIA_AUDIT);
  await queue.upsertJobScheduler(
    "media-audit",
    // tz 显式声明:缺省走进程系统时区,靠镜像 ENV TZ 兜底属侥幸(2026-10-05 review 定级)
    { pattern: MEDIA_AUDIT_CRON, tz: SITE_TZ },
    {
      name: "audit",
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

export async function schedulePricingSync(): Promise<void> {
  const queue = getQueue(QUEUE_PRICING);
  await queue.upsertJobScheduler(
    PRICING_JOB_SYNC,
    { pattern: PRICING_SYNC_CRON, tz: SITE_TZ },
    {
      name: PRICING_JOB_SYNC,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** hold 候选临时件清扫:每日 04:23 清 24h+ 孤儿 token 目录(悬空中断/顶替遗留,
 * 技术债批①;清扫逻辑 lib/ai/cover-generate#sweepStaleCoverTemp) */
export async function scheduleCoverTempSweep(): Promise<void> {
  const queue = getQueue(QUEUE_COVER_GEN);
  await queue.upsertJobScheduler(
    "cover-temp-sweep",
    { pattern: COVER_TEMP_SWEEP_CRON, tz: SITE_TZ },
    {
      name: COVER_JOB_TEMP_SWEEP,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** 访问明细清理:每日 04:14 清 7 天前行(M10 批⑥) */
export async function scheduleVisitLogPurge(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "visit-log-purge",
    { pattern: VISIT_LOG_PURGE_CRON, tz: SITE_TZ },
    {
      name: STATS_JOB_PURGE,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** AI 用量台账清理:每日 04:52 清 90 天前行(M14 批⑦) */
export async function scheduleUsageLogPurge(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "usage-log-purge",
    { pattern: USAGE_LOG_PURGE_CRON, tz: SITE_TZ },
    {
      name: STATS_JOB_USAGE_PURGE,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** Drawer 会话清退:每日 04:33 清 30 天前留档(K2.5;行+checkpoint 同删) */
export async function scheduleAgentSessionPurge(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "agent-session-purge",
    { pattern: AGENT_SESSION_PURGE_CRON, tz: SITE_TZ },
    {
      name: STATS_JOB_AGENT_PURGE,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** 任务运行台账清退:每日 04:47 清 30 天前运行记录 + 崩溃残留代收口
 * (验收二批③;04 点清理带错峰:14/23/33/47/52) */
export async function scheduleJobRunPurge(): Promise<void> {
  const queue = getQueue(QUEUE_STATS);
  await queue.upsertJobScheduler(
    "job-run-purge",
    { pattern: JOB_RUN_PURGE_CRON, tz: SITE_TZ },
    {
      name: STATS_JOB_RUN_PURGE,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** 小红书登录态每日探照:04:37 错峰(M50 批F;结果落 site_config kv,
 * 分发中心渠道卡直读;探照异常只 warn 不进队列失败计数) */
export async function scheduleXhsStateProbe(): Promise<void> {
  const queue = getQueue(QUEUE_DISTRIBUTE);
  await queue.upsertJobScheduler(
    "xhs-state-probe",
    { pattern: "37 4 * * *", tz: SITE_TZ },
    {
      name: DISTRIBUTE_JOB_XHS_STATE_PROBE,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** 数据库每日备份:03:23 pg_dump → 备份桶(M19 批②,M6 异机存放落地) */
export async function scheduleDbBackup(): Promise<void> {
  const queue = getQueue(QUEUE_DB_BACKUP);
  await queue.upsertJobScheduler(
    "db-backup",
    { pattern: DB_BACKUP_CRON, tz: SITE_TZ },
    {
      name: DB_BACKUP_JOB_RUN,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** embedding 对账:每 15 分钟扫 stale 三域向量(M20 批②;批 120 条,存量回填多轮收敛) */
export async function scheduleEmbedReconcile(): Promise<void> {
  const queue = getQueue(QUEUE_EMBED);
  await queue.upsertJobScheduler(
    "embed-reconcile",
    { pattern: EMBED_RECONCILE_CRON, tz: SITE_TZ },
    {
      name: EMBED_JOB_RECONCILE,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** 支付对账 sweep:每 5 分钟收敛近过期 pending 单(提案 §5.2;tick 粒度同 github) */
const PAY_SWEEP_EVERY_MS = 300_000;

export async function schedulePayReconcile(): Promise<void> {
  const queue = getQueue(QUEUE_PAY_RECONCILE);
  await queue.upsertJobScheduler(
    "pay-reconcile-sweep",
    { every: PAY_SWEEP_EVERY_MS },
    {
      name: PAY_JOB_SWEEP,
      data: {},
      opts: schedulerOpts(50),
    },
  );
  await queue.upsertJobScheduler(
    "pay-reconcile-daily-audit",
    { pattern: PAY_DAILY_AUDIT_CRON, tz: SITE_TZ },
    {
      name: PAY_JOB_DAILY_AUDIT,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** 优质内容发现调度(M25):热词 05:37 日频 + B站双窗周一 06:13(cron 见 lib/queue) */
export async function scheduleDiscovery(): Promise<void> {
  const queue = getQueue(QUEUE_DISCOVERY);
  await queue.upsertJobScheduler(
    "discovery-hotwords",
    { pattern: DISCOVERY_HOTWORDS_CRON, tz: SITE_TZ },
    {
      name: DISCOVERY_JOB_HOTWORDS,
      data: {},
      opts: schedulerOpts(7),
    },
  );
  await queue.upsertJobScheduler(
    "discovery-bili",
    { pattern: DISCOVERY_BILI_CRON, tz: SITE_TZ },
    {
      name: DISCOVERY_JOB_BILI,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** 洞察加工调度(M34 批②→批③):向量回填+聚类 15 分钟错峰 / LLM 打标日批
 * 03:57 / 热榜拉取小时批 :43(验收二批② 提频,外部渠道) */
export async function scheduleInsight(): Promise<void> {
  const queue = getQueue(QUEUE_INSIGHT);
  await queue.upsertJobScheduler(
    "insight-embed",
    { pattern: INSIGHT_EMBED_CRON, tz: SITE_TZ },
    {
      name: INSIGHT_JOB_EMBED,
      data: {},
      opts: schedulerOpts(50),
    },
  );
  await queue.upsertJobScheduler(
    "insight-daily",
    { pattern: INSIGHT_DAILY_CRON, tz: SITE_TZ },
    {
      name: INSIGHT_JOB_DAILY,
      data: {},
      opts: schedulerOpts(7),
    },
  );
  await queue.upsertJobScheduler(
    "insight-fetch",
    { pattern: INSIGHT_FETCH_CRON, tz: SITE_TZ },
    {
      name: INSIGHT_JOB_FETCH,
      data: {},
      opts: schedulerOpts(7),
    },
  );
}

/** 采集 tick:每分钟扫描到期来源逐源入队(渠道频率差异由 crawl_source.next_run_at 表达) */
const CRAWLER_TICK_EVERY_MS = 60_000;

export async function scheduleCrawlerTick(): Promise<void> {
  const queue = getQueue(QUEUE_CRAWLER);
  await queue.upsertJobScheduler(
    "crawler-tick",
    { every: CRAWLER_TICK_EVERY_MS },
    {
      name: CRAWL_JOB_TICK,
      data: {},
      opts: schedulerOpts(50),
    },
  );
}

/** GitHub 同步 tick:每 5 分钟扫到期白名单仓(逐仓间隔由 github_repo.next_sync_at 表达;
 * 5min 粒度相对 600s ISR 前台窗口不可见) */
const GITHUB_TICK_EVERY_MS = 300_000;

export async function scheduleGithubTick(): Promise<void> {
  const queue = getQueue(QUEUE_GITHUB);
  await queue.upsertJobScheduler(
    "github-tick",
    { every: GITHUB_TICK_EVERY_MS },
    {
      name: GITHUB_JOB_TICK,
      data: {},
      opts: schedulerOpts(50),
    },
  );
}

/** AI 存量补扫 tick(M12 批③):每 5 分钟扫未解读可见条分流入 interpret/summarize;
 * 就绪检查与每类 5 条上限在 backfillAiPending 内收敛 */
const AI_BACKFILL_TICK_EVERY_MS = 300_000;

export async function scheduleAiBackfillTick(): Promise<void> {
  const queue = getQueue(QUEUE_CRAWLER);
  await queue.upsertJobScheduler(
    "ai-backfill-tick",
    { every: AI_BACKFILL_TICK_EVERY_MS },
    {
      name: CRAWL_JOB_AI_BACKFILL,
      data: {},
      opts: schedulerOpts(50),
    },
  );
}
