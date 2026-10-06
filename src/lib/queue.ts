import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

import { env } from "./env";

/**
 * BullMQ producer 侧封装(arch/00-overview §2:请求内只 enqueue,处理一律在 worker 进程)。
 * BullMQ 要求连接 maxRetriesPerRequest: null,与应用侧 lib/redis.ts 分开建连。
 */
export const QUEUE_MEDIA_PROCESS = "media-process";
/** 一键发文外链图转存(md 导入;arch/05-services §4.2,失败标 error 供编辑器提示) */
export const QUEUE_MEDIA_TRANSFER = "media-transfer";
/** 媒体体检(每日定时 + 后台手动触发;arch/08-media §3.2) */
export const QUEUE_MEDIA_AUDIT = "media-audit";
/** 站点统计日聚合(requirement §3.5:beacon → Redis 缓冲 → worker 聚合落库) */
export const QUEUE_STATS = "stats";
/** 电报流采集(M7:tick 扫到期来源 → 逐源 crawl job,单源失败隔离;arch/02 §3) */
export const QUEUE_CRAWLER = "crawler";
/** 视频解读(M9:下载→抽轨→ASR→LLM 概括;并发 1——ffmpeg 是 CPU 峰值,arch/02 §3.2) */
export const QUEUE_INTERPRETER = "interpreter";
/** 文字资讯轻解读(M12 批③:一句话中心思想 + 要点 + 关键词;与视频分队列防长任务阻塞) */
export const QUEUE_SUMMARIZER = "summarizer";
/** GitHub 项目展示(M11:tick 扫到期白名单仓 → 逐仓 sync job,单仓失败隔离;arch/05 §4) */
export const QUEUE_GITHUB = "github";
/** 文生图封面(M14 批⑥,验收反馈问题6):编辑器「AI 生成候选」→ worker 生图入
 * 媒体库 + 候选落库,编辑器凭 token 轮询;云厂商生图 10-30s,不占请求(请求内禁秒级任务) */
export const QUEUE_COVER_GEN = "cover-gen";
/** 批量 SEO 补全(M16 问题8,仅补空缺):文章管理多选 → 单批次 job 顺序逐篇;
 * LLM 秒级调用 × ≤50 篇,并发 1 防打爆绑定模型,lockDuration 600s 兜底 */
export const QUEUE_SEO_BATCH = "seo-batch";
/** 内容分发(M17,requirement §4 多渠道分发):公众号推草稿;
 * 并发 1 全局串行(微信接口频控),lockDuration 900s 覆盖单批 30 篇 × ~15s */
export const QUEUE_DISTRIBUTE = "distribute";

export const QUEUE_NAMES = [
  QUEUE_MEDIA_PROCESS,
  QUEUE_MEDIA_TRANSFER,
  QUEUE_MEDIA_AUDIT,
  QUEUE_STATS,
  QUEUE_CRAWLER,
  QUEUE_INTERPRETER,
  QUEUE_SUMMARIZER,
  QUEUE_GITHUB,
  QUEUE_COVER_GEN,
  QUEUE_SEO_BATCH,
  QUEUE_DISTRIBUTE,
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/** 媒体体检每日调度(避开整点;arch/08-media §3.2;worker 与媒体库页脚同源,评审 W2) */
export const MEDIA_AUDIT_CRON = "41 3 * * *";

/** 访问明细 7 天保留期清理(M10 批⑥;凌晨档避开 media-audit) */
export const VISIT_LOG_PURGE_CRON = "14 4 * * *";

/** crawler 队列 job name 契约(生产:tick 调度/ingest.ts/ingest-video.ts/bloggers-admin.ts;
 * 消费:worker 按 job.name 分流,crawl 为缺省路径)。改名需与 worker 同批。
 * ai-backfill(M12 批③)借 crawler 队列的 tick 生态做 AI 存量补扫调度(纯入队,轻)。 */
export const CRAWL_JOB_TICK = "tick";
export const CRAWL_JOB_SOURCE = "crawl";
export const CRAWL_JOB_VIDEO = "crawl-video";
export const CRAWL_JOB_AI_BACKFILL = "ai-backfill";

/** cover-gen 队列 job name 契约(M14 批⑥;generate 为缺省路径,编辑器手动触发) */
export const COVER_JOB_GEN = "generate";

/** seo-batch 队列 job name 契约(M16;batch 为缺省路径,文章管理手动触发) */
export const SEO_JOB_BATCH = "batch";

/** distribute 队列 job name 契约(M17;wechat-sync 单篇为缺省路径——手动一键/发布
 * 自动共用;wechat-batch 批量单 job 顺序逐篇)。改名需与 worker 同批。 */
export const DISTRIBUTE_JOB_WECHAT = "wechat-sync";
export const DISTRIBUTE_JOB_WECHAT_BATCH = "wechat-batch";

/** stats 队列 job name 契约(flush 为缺省路径;purge 清理访问明细;
 * purge-usage-log 清理 AI 用量台账,M14 批⑦;purge-agent-session 清退
 * Drawer 会话 30 天前留档,K2.5) */
export const STATS_JOB_FLUSH = "flush";
export const STATS_JOB_PURGE = "purge-visit-log";
export const STATS_JOB_USAGE_PURGE = "purge-usage-log";
export const STATS_JOB_AGENT_PURGE = "purge-agent-session";

/** AI 用量台账 90 天保留期清理(凌晨档,与 visit-log/media-audit 错峰) */
export const USAGE_LOG_PURGE_CRON = "52 4 * * *";

/** Drawer 会话 30 天自动清退(凌晨档错峰:audit 03:41 / visit 04:14 / agent 04:33 / usage 04:52) */
export const AGENT_SESSION_PURGE_CRON = "33 4 * * *";

/** github 队列 job name 契约(生产:tick 调度/sync.ts/repos-admin.ts;消费:worker 按
 * job.name 分流,sync 为缺省路径)。改名需与 worker 同批。 */
export const GITHUB_JOB_TICK = "tick";
export const GITHUB_JOB_SYNC = "sync";

export function bullConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullConnection() as unknown as ConnectionOptions });
    queues.set(name, q);
  }
  return q;
}
