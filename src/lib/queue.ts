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

export const QUEUE_NAMES = [
  QUEUE_MEDIA_PROCESS,
  QUEUE_MEDIA_TRANSFER,
  QUEUE_MEDIA_AUDIT,
  QUEUE_STATS,
  QUEUE_CRAWLER,
  QUEUE_INTERPRETER,
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/** 媒体体检每日调度(避开整点;arch/08-media §3.2;worker 与媒体库页脚同源,评审 W2) */
export const MEDIA_AUDIT_CRON = "41 3 * * *";

/** 访问明细 7 天保留期清理(M10 批⑥;凌晨档避开 media-audit) */
export const VISIT_LOG_PURGE_CRON = "14 4 * * *";

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
