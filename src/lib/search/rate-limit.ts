/**
 * 答案接口 IP 频控(K2 护栏):10 次/分/IP,Redis INCR+TTL。
 * Redis 异常放行(护栏非计费,不因缓存件故障拒绝服务);无代理头(本机
 * 直连调试)不拦,口径同 auth/rate-limit。
 */
import { redis } from "@/lib/redis";

export const ANSWER_RL_LIMIT = 10;
export const ANSWER_RL_WINDOW_SECONDS = 60;

const rlKey = (ip: string, epochMinute: number): string => `search:answer:rl:${ip}:${epochMinute}`;

/** 消耗一次配额;超限 false(Router → 429) */
export async function tryConsumeAnswerQuota(ip: string): Promise<boolean> {
  if (!ip) return true;
  const epochMinute = Math.floor(Date.now() / 60_000);
  try {
    const n = await redis.incr(rlKey(ip, epochMinute));
    if (n === 1) await redis.expire(rlKey(ip, epochMinute), ANSWER_RL_WINDOW_SECONDS);
    return n <= ANSWER_RL_LIMIT;
  } catch {
    return true;
  }
}
