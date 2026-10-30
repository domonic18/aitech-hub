/**
 * Drawer 会话清退(K2.5/K2.6;M58 批⑤ 后续游客留档):会话行(含游客匿名
 * 档案行)30 天日清(行+checkpoint 同删);无档案行的历史游客线程按 Redis
 * 活跃键消失清扫 checkpoint。
 * checkpoint 删失败一律不反噬(残留下轮再扫)。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { redis } from "../redis";

import { deleteThread, getAgentPgPool } from "./checkpointer";
import { GUEST_THREAD_PREFIX, guestThreadKey } from "./guest-threads";

/** 单轮批量(按批循环至清空;20 会话/日/visitor 配额下日增量远小于此) */
const PURGE_BATCH = 200;
/** 游客清扫单轮上限(checkpoints 全表按日扫,3 问/日/游客 增量远小于此) */
const GUEST_PURGE_LIMIT = 500;

/** 清退 lastMessageAt 超 30 天的会话;返回删除行数(供 worker 日志) */
export async function purgeAgentSessions(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * 24 * 3600_000);
  let removed = 0;
  for (;;) {
    const rows = await prisma.searchAgentSession.findMany({
      where: { lastMessageAt: { lt: cutoff } },
      select: { id: true },
      take: PURGE_BATCH,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      await prisma.searchAgentSession.delete({ where: { id: row.id } });
      try {
        await deleteThread(row.id);
      } catch (e) {
        logger.warn({
          event: "agent.purge_checkpoint_failed",
          threadId: row.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      removed += 1;
    }
    if (rows.length < PURGE_BATCH) break;
  }
  return removed;
}

/**
 * 游客线程 checkpoint 清扫(K2.6;M58 批⑤ 后续留档):g_ 前缀线程的活跃
 * TTL 在 Redis(search:agent:gthread:*,2h 滑动),但**有存档行**的线程内容
 * 随行按 30 天日滞留档,不因归属键消失而清 checkpoint——归属键只决定能否
 * 继续追问。仅无行的历史线程沿用「键消失即清」。返回删除数(供 worker 日志)。
 */
export async function purgeExpiredGuestThreads(): Promise<number> {
  // LIKE 模式:前缀中 _ 是通配符,转义为字面量(g\_%)
  const prefixLike = `${GUEST_THREAD_PREFIX.replace("_", "\\_")}%`;
  const result = await getAgentPgPool().query<{ thread_id: string }>(
    `SELECT DISTINCT thread_id FROM checkpoints WHERE thread_id LIKE $1 LIMIT ${GUEST_PURGE_LIMIT}`,
    [prefixLike],
  );
  const threadIds = result.rows.map((r) => r.thread_id);
  if (threadIds.length === 0) return 0;
  // 有档案行 = 留档期内,交给会话行 30 天日清统一处理
  const archived = new Set(
    (
      await prisma.searchAgentSession.findMany({
        where: { id: { in: threadIds } },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  let removed = 0;
  for (const threadId of threadIds) {
    if (archived.has(threadId)) continue;
    try {
      if (await redis.exists(guestThreadKey(threadId))) continue;
      await deleteThread(threadId);
      removed += 1;
    } catch (e) {
      logger.warn({
        event: "agent.purge_guest_failed",
        threadId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return removed;
}
