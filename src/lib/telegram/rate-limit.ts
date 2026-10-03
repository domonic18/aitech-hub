/**
 * 渠道每日请求上限(M7,arch/02 §3.1):Redis INCR 计数,key 按统计日切分,
 * TTL 48h 覆盖跨日边界;超限只跳过本轮不计失败——这是成本/频控护栏,非错误。
 * 走应用侧 redis 单例(非 BullMQ 连接),与 auth 频控同源。
 */
import { statsDay } from "../datetime";
import { redis } from "../redis";

export function dailyRequestKey(sourceId: number, day = statsDay()): string {
  return `crawler:req:${sourceId}:${day}`;
}

/** 计数并返回是否放行(先 INCR 后比较;超限多计 1 次无碍——护栏非计费) */
export async function tryConsumeDailyQuota(sourceId: number, dailyMax: number): Promise<boolean> {
  const key = dailyRequestKey(sourceId);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 48 * 3600);
  return count <= dailyMax;
}
