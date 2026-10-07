/**
 * 游客线程生命周期(K2.6,arch/04 §3.1 游客模式):游客不落 search_agent_session
 * 行,归属与活跃 TTL 全在 Redis——`g_` 前缀 thread_id + `search:agent:gthread:*`
 * 键(值=visitorId,2h 活跃 TTL,run 成功即续期)。故障口径与配额不同:
 * 归属校验是隔离边界,**Redis 挂一律拒绝**(fail-closed);配额才放行(护栏非计费)。
 */
import { redis } from "../redis";

export const GUEST_THREAD_PREFIX = "g_";
export const GUEST_THREAD_TTL_SECONDS = 2 * 3600;

export const guestThreadKey = (threadId: string): string => `search:agent:gthread:${threadId}`;

export function isGuestThreadId(threadId: string): boolean {
  return threadId.startsWith(GUEST_THREAD_PREFIX);
}

export function newGuestThreadId(): string {
  return `${GUEST_THREAD_PREFIX}${crypto.randomUUID()}`;
}

/** 建线程即绑归属(POST /threads 游客分支);Redis 挂抛出(fail-closed) */
export async function bindGuestThread(threadId: string, visitorId: string): Promise<void> {
  await redis.set(guestThreadKey(threadId), visitorId, "EX", GUEST_THREAD_TTL_SECONDS);
}

/** 归属读取:键不存在(过期/未建)返回 null;调用方按 404 处理 */
export async function getGuestThreadOwner(threadId: string): Promise<string | null> {
  try {
    return await redis.get(guestThreadKey(threadId));
  } catch {
    return null; // fail-closed:读不到 = 不属于你
  }
}

/** run 成功续期(活跃滑动 TTL);失败仅告警——下一轮 2h 自然过期 */
export async function refreshGuestThread(threadId: string): Promise<void> {
  try {
    await redis.expire(guestThreadKey(threadId), GUEST_THREAD_TTL_SECONDS);
  } catch {
    // 过期兜底在 worker 日清;此处不反噬 run
  }
}

/** 归属校验式解绑(DELETE 路由游客分支);非本人/不存在返 false */
export async function unbindGuestThread(threadId: string, visitorId: string): Promise<boolean> {
  const owner = await getGuestThreadOwner(threadId);
  if (!owner || owner !== visitorId) return false;
  await redis.del(guestThreadKey(threadId));
  return true;
}
