/**
 * 登录爆破防护(arch/05-services §3.1):Redis 计数。
 * 同账号连错 5 次锁 15min;同 IP 日失败上限 50 次;登录成功清账号计数。
 * 阈值为常量不进 env(YAGNI);提示语由 Handler 统一模糊,不区分锁定/密码错。
 */
import { redis } from "@/lib/redis";

export const ACCOUNT_FAIL_LIMIT = 5;
export const ACCOUNT_LOCK_SECONDS = 15 * 60;
export const IP_FAIL_LIMIT = 50;
export const IP_WINDOW_SECONDS = 24 * 3600;

const accountKey = (phone: string): string => `auth:fail:acct:${phone}`;
const ipKey = (ip: string): string => `auth:fail:ip:${ip}`;

export async function isAccountLocked(phone: string): Promise<boolean> {
  const n = await redis.get(accountKey(phone));
  return n !== null && Number(n) >= ACCOUNT_FAIL_LIMIT;
}

export async function isIpBlocked(ip: string): Promise<boolean> {
  if (!ip) return false; // 本机直连调试无代理头,不进 IP 桶
  const n = await redis.get(ipKey(ip));
  return n !== null && Number(n) >= IP_FAIL_LIMIT;
}

/** 记一次账号失败;首次计数时设锁定窗 TTL */
export async function recordAccountFail(phone: string): Promise<void> {
  const key = accountKey(phone);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, ACCOUNT_LOCK_SECONDS);
}

/** 记一次 IP 失败;首次计数时设日窗 TTL */
export async function recordIpFail(ip: string): Promise<void> {
  if (!ip) return;
  const key = ipKey(ip);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, IP_WINDOW_SECONDS);
}

export async function clearAccountFails(phone: string): Promise<void> {
  await redis.del(accountKey(phone));
}
