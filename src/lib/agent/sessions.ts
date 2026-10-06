/**
 * 会话索引 CRUD(K2.5):search_agent_session 行管理。行是「线程列表+归属+
 * 清退」锚点;消息轨迹在 LangGraph checkpoint(框架表),删除=行+checkpoint
 * 同删。今/昨/更早分组在前端做(Date 原生),服务端只出平铺列表。
 */
import { prisma } from "../db";
import { logger } from "../logger";

import { deleteThread } from "./checkpointer";

/** 单 visitor 列表上限(列表分组的上游;超老会话靠 30 天清退自然收敛) */
export const AGENT_SESSION_LIST_MAX = 100;

/** 标题派生:首行前 20 码点(run 收尾回填;空消息回落「新会话」) */
export function deriveTitle(message: string): string {
  const firstLine = message.trim().split("\n")[0]?.trim() ?? "";
  if (firstLine === "") return "新会话";
  return [...firstLine].slice(0, 20).join("");
}

export async function listSessions(visitorId: string) {
  return prisma.searchAgentSession.findMany({
    where: { visitorId },
    orderBy: { lastMessageAt: "desc" },
    take: AGENT_SESSION_LIST_MAX,
    select: { id: true, title: true, createdAt: true, lastMessageAt: true },
  });
}

export async function createSession(visitorId: string): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await prisma.searchAgentSession.create({ data: { id, visitorId } });
  return { id };
}

/** 归属校验式删除:行+checkpoint 同删;不存在/非本人返 false(路由 404) */
export async function deleteSession(visitorId: string, threadId: string): Promise<boolean> {
  const row = await prisma.searchAgentSession.findUnique({
    where: { id: threadId },
    select: { visitorId: true },
  });
  if (!row || row.visitorId !== visitorId) return false;
  await prisma.searchAgentSession.delete({ where: { id: threadId } });
  try {
    await deleteThread(threadId);
  } catch (e) {
    // checkpoint 残留由 30 天日清兜底再扫;行已删则列表不再可见
    logger.warn({
      event: "agent.checkpoint_delete_failed",
      threadId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  return true;
}

/** run 收尾:touch 活跃时间 + tokens 累计(50k 护栏口径) */
export async function touchSessionAfterRun(sessionId: string, tokens: number): Promise<void> {
  await prisma.searchAgentSession.update({
    where: { id: sessionId },
    data: { lastMessageAt: new Date(), tokensTotal: { increment: Math.max(0, tokens) } },
  });
}

/** 标题回填(仅首个 run:标题为空的行) */
export async function backfillSessionTitle(sessionId: string, message: string): Promise<void> {
  await prisma.searchAgentSession.updateMany({
    where: { id: sessionId, title: null },
    data: { title: deriveTitle(message) },
  });
}
