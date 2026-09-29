import Redis from "ioredis";

import { env } from "./env";

/**
 * 应用侧 Redis 单例(验证码/频控/会话吊销/legacy 缓存)。
 * 注意:BullMQ 队列连接不要用这里——见 lib/queue.ts(需 maxRetriesPerRequest: null)。
 */
const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis = globalForRedis.redis ?? new Redis(env.REDIS_URL, { lazyConnect: true });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
