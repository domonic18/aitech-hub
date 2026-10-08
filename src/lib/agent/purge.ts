/**
 * Drawer 会话清退(K2.5/K2.6):member 行 30 天日清(行+checkpoint 同删);
 * 游客线程(g_ 前缀,无行)按 Redis 活跃键消失清扫 checkpoint。checkpoint
 * 删失败一律不反噬(残留下轮再扫)。
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
 * 游客线程 checkpoint 清扫(K2.6):g_ 前缀线程的活跃 TTL 在 Redis
 * (search:agent:gthread:*,2h 滑动),键消失即清退——扫描 checkpoints 表
 * g_ 线程,Redis 键已不在 → deleteThread。返回删除数(供 worker 日志)。
 */
export async function purgeExpiredGuestThreads(): Promise<number> {
  // LIKE 模式:前缀中 _ 是通配符,转义为字面量(g\_%)
  const prefixLike = `${GUEST_THREAD_PREFIX.replace("_", "\\_")}%`;
  const result = await getAgentPgPool().query<{ thread_id: string }>(
    `SELECT DISTINCT thread_id FROM checkpoints WHERE thread_id LIKE $1 LIMIT ${GUEST_PURGE_LIMIT}`,
    [prefixLike],
  );
  let removed = 0;
  for (const row of result.rows) {
    try {
      if (await redis.exists(guestThreadKey(row.thread_id))) continue;
      await deleteThread(row.thread_id);
      removed += 1;
    } catch (e) {
      logger.warn({
        event: "agent.purge_guest_failed",
        threadId: row.thread_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return removed;
}
