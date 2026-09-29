import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

import { env } from "./env";

/**
 * BullMQ producer 侧封装(00 文档 §2:请求内只 enqueue,处理一律在 worker 进程)。
 * BullMQ 要求连接 maxRetriesPerRequest: null,与应用侧 lib/redis.ts 分开建连。
 */
export const QUEUE_MEDIA_PROCESS = "media-process";

export const QUEUE_NAMES = [QUEUE_MEDIA_PROCESS] as const;
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
