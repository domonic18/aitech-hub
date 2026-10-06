/**
 * Drawer 会话日配额(K2.5,arch/04 §3.4):20 新会话/日/visitor,独立计数
 * (Redis INCR 北京日界 key,statsDay 口径)——与答案卡 search 角色 100/日
 * (ai_usage_log 计数)互不侵占。Redis 挂放行(护栏非计费,同 rate-limit 口径)。
 */
import { statsDay } from "../datetime";
import { redis } from "../redis";

export const AGENT_SESSION_DAILY_MAX = 20;

const quotaKey = (visitorId: string, day: string): string =>
  `search:agent:sess:${visitorId}:${day}`;

/** 消耗一次建会话配额;超限 false(路由 → 429) */
export async function tryConsumeSessionQuota(visitorId: string): Promise<boolean> {
  const key = quotaKey(visitorId, statsDay());
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 2 * 24 * 3600); // 跨日冗余 TTL,防 key 永生
    return n <= AGENT_SESSION_DAILY_MAX;
  } catch {
    return true;
  }
}
