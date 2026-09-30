import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

import { env } from "./env";

/**
 * BullMQ producer 侧封装(arch/00-overview §2:请求内只 enqueue,处理一律在 worker 进程)。
 * BullMQ 要求连接 maxRetriesPerRequest: null,与应用侧 lib/redis.ts 分开建连。
 */
export const QUEUE_MEDIA_PROCESS = "media-process";
/** 站点统计日聚合(requirement §3.5:beacon → Redis 缓冲 → worker 聚合落库) */
export const QUEUE_STATS = "stats";

export const QUEUE_NAMES = [QUEUE_MEDIA_PROCESS, QUEUE_STATS] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

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
