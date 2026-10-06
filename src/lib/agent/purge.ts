/**
 * Drawer 会话 30 天自动清退(K2.5,用户拍板「30 天自动清退 + 用户可删」):
 * worker 日清逐行删 search_agent_session 行 + 对应 LangGraph checkpoint
 * (deleteThread 内部 ensure,checkpoint 删失败不反噬——行删后列表不可见,
 * 残留 checkpoint 由 30 天后下一轮再扫,同 sessions.ts 删除口径)。
 */
import { prisma } from "../db";
import { logger } from "../logger";

import { deleteThread } from "./checkpointer";

/** 单轮批量(按批循环至清空;20 会话/日/visitor 配额下日增量远小于此) */
const PURGE_BATCH = 200;

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
