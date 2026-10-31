/**
 * 短信发送频控与预算熔断(M65,plan M65)。
 *
 * 三层闸门,全部 Redis 计数(阈值常量不进 env,YAGNI;调参走发版):
 *   1. 同号:60 秒冷却 / 每小时 5 条 / 每日 10 条
 *   2. 同 IP:每小时 10 条 / 每日 30 条
 *   3. 全局:日发送预算(admin 可配,缺省 200)硬熔断 + 80% 预警
 *
 * 预算采用「先占位后发送」:INCR 超过阈值即回滚并拒绝,避免并发请求把额度
 * 打穿(账已记、短信未发)。发送失败(服务商拒绝/网络错)由调用方回滚占位。
 *
 * 校验失败另计:同号错 5 次锁 15 分钟——PNVS 自身也有校验次数上限,这里
 * 只做站点侧兜底,保证错误提示口径统一。
 */
import { redis } from "@/lib/redis";

import { isOverLimit, recordHit } from "@/lib/auth/rate-limit";

/** 同号冷却(秒);与 PNVS `interval` 参数同值 */
export const SMS_PHONE_COOLDOWN_SECONDS = 60;
export const SMS_PHONE_HOUR_LIMIT = 5;
export const SMS_PHONE_DAY_LIMIT = 10;
export const SMS_IP_HOUR_LIMIT = 10;
export const SMS_IP_DAY_LIMIT = 30;

export const SMS_VERIFY_FAIL_LIMIT = 5;
export const SMS_VERIFY_LOCK_SECONDS = 15 * 60;

/** 预算用量占比达到该值即打 warn(不到熔断线,但值得看一眼) */
export const SMS_BUDGET_WARN_RATIO = 0.8;

const HOUR = 3600;
const DAY = 24 * HOUR;

const phoneCooldownKey = (phone: string): string => `sms:send:phone:cd:${phone}`;
const phoneHourKey = (phone: string): string => `sms:send:phone:h:${phone}`;
const phoneDayKey = (phone: string): string => `sms:send:phone:d:${phone}`;
const ipHourKey = (ip: string): string => `sms:send:ip:h:${ip}`;
const ipDayKey = (ip: string): string => `sms:send:ip:d:${ip}`;
const verifyFailKey = (phone: string): string => `sms:verify:fail:${phone}`;

/** 预算窗口按东八区自然日切;导出便于单测注入时刻 */
export function budgetDayStamp(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 8 * HOUR * 1000);
  return shifted.toISOString().slice(0, 10);
}

const budgetKey = (now?: Date): string => `sms:send:global:d:${budgetDayStamp(now)}`;

export type SendQuotaScope = "phone" | "ip" | "budget";

export type SendQuotaVerdict = { ok: true } | { ok: false; scope: SendQuotaScope };

/** 发送前闸门(只读判定,不记账) */
export async function checkSendQuota(
  phone: string,
  ip: string,
  dailyLimit: number,
): Promise<SendQuotaVerdict> {
  if (await redis.get(phoneCooldownKey(phone))) return { ok: false, scope: "phone" };
  if (await isOverLimit(phoneHourKey(phone), SMS_PHONE_HOUR_LIMIT))
    return { ok: false, scope: "phone" };
  if (await isOverLimit(phoneDayKey(phone), SMS_PHONE_DAY_LIMIT))
    return { ok: false, scope: "phone" };
  if (ip) {
    if (await isOverLimit(ipHourKey(ip), SMS_IP_HOUR_LIMIT)) return { ok: false, scope: "ip" };
    if (await isOverLimit(ipDayKey(ip), SMS_IP_DAY_LIMIT)) return { ok: false, scope: "ip" };
  }
  const used = Number((await redis.get(budgetKey())) ?? 0);
  if (used >= dailyLimit) return { ok: false, scope: "budget" };
  return { ok: true };
}

/**
 * 预占全局日预算:返回 false = 已达熔断线(已回滚占位)。
 * 同一次发送只需调用一次;发送失败时调 `releaseSendBudget` 归还。
 */
export async function reserveSendBudget(dailyLimit: number): Promise<boolean> {
  const key = budgetKey();
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, DAY + HOUR);
  if (n > dailyLimit) {
    await redis.decr(key);
    return false;
  }
  return true;
}

/** 归还一次预算占位(发送失败时调用,尽力而为) */
export async function releaseSendBudget(): Promise<void> {
  const key = budgetKey();
  const n = await redis.decr(key);
  if (n < 0) await redis.set(key, 0, "EX", DAY + HOUR);
}

/** 当日预算用量(预警/日志用) */
export async function getSendBudgetUsage(): Promise<number> {
  return Number((await redis.get(budgetKey())) ?? 0);
}

/** 记录一次成功发送:置冷却 + 各桶计数(全局预算已由 reserve 计入) */
export async function recordSend(phone: string, ip: string): Promise<void> {
  await redis.set(phoneCooldownKey(phone), "1", "EX", SMS_PHONE_COOLDOWN_SECONDS);
  await recordHit(phoneHourKey(phone), HOUR);
  await recordHit(phoneDayKey(phone), DAY);
  if (ip) {
    await recordHit(ipHourKey(ip), HOUR);
    await recordHit(ipDayKey(ip), DAY);
  }
}

/** 校验失败锁定(5 次 / 15 分钟) */
export async function isVerifyLocked(phone: string): Promise<boolean> {
  return isOverLimit(verifyFailKey(phone), SMS_VERIFY_FAIL_LIMIT);
}

/** 记一次校验失败,返回当前累计次数(用于日志与提示分级) */
export async function recordVerifyFail(phone: string): Promise<number> {
  const key = verifyFailKey(phone);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, SMS_VERIFY_LOCK_SECONDS);
  return n;
}

export async function clearVerifyFails(phone: string): Promise<void> {
  await redis.del(verifyFailKey(phone));
}
