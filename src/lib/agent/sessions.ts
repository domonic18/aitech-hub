/**
 * 会话索引 CRUD(K2.5):search_agent_session 行管理。行是「线程列表+归属+
 * 清退」锚点;消息轨迹在 LangGraph checkpoint(框架表),删除=行+checkpoint
 * 同删。今/昨/更早分组在前端做(Date 原生),服务端只出平铺列表。
 */
import { prisma } from "../db";
import { ingestInsightSignal } from "../insight/ingest";
import { logger } from "../logger";
import { redis } from "../redis";

import { deleteThread } from "./checkpointer";
import { isAdminSurface } from "./run-context";

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

/**
 * 游客 run 收尾:落/续匿名会话行,供后台会话管理查看标题与内容留档(30 天
 * 日清,与成员同口径)。归属仍以 Redis 归属键判定,本行只作审计档案;建行
 * 失败只告警不反噬已完成的 run。
 */
export async function touchGuestSessionAfterRun(
  threadId: string,
  message: string | null,
  tokens: number,
): Promise<void> {
  try {
    const now = new Date();
    await prisma.searchAgentSession.upsert({
      where: { id: threadId },
      create: {
        id: threadId,
        visitorId: GUEST_SESSION_OWNER,
        title: message === null ? null : deriveTitle(message),
        lastMessageAt: now,
        tokensTotal: Math.max(0, tokens),
      },
      update: { lastMessageAt: now, tokensTotal: { increment: Math.max(0, tokens) } },
    });
    // 兼容先有行后补标题(upsert 命中既有行且 title 为空)
    if (message !== null) {
      await prisma.searchAgentSession.updateMany({
        where: { id: threadId, title: null },
        data: { title: deriveTitle(message) },
      });
    }
  } catch (e) {
    logger.warn({
      event: "agent.guest_session_touch_failed",
      threadId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 游客会话行匿名属主(M58 批⑤ 后续):不存访客标识,不做个人关联;归属
 * 校验仍以 Redis 归属键为界,本行只作后台审计档案。 */
export const GUEST_SESSION_OWNER = "guest";

/** 站内问句入池(M58 批⑤,arch/01 §3.4):只收前台公开页——后台功能页与
 * **无页面上下文**一律不入池(M61:上下文缺失时无法区分前台提问与后台创作,
 * 编辑器/创作中心的旧客户端正是这样把改稿、生图对话漏进「助手问句」的);
 * `meta.surface` 记入口便于调规则。ingest 自吞异常,fire-and-forget 不反噬
 * 响应流。 */
function captureAsk(refId: string, message: string, page: string | null | undefined): void {
  if (page === null || page === undefined || isAdminSurface(page)) return;
  void ingestInsightSignal({
    source: "internal-agent",
    refId,
    rawText: message,
    signalAt: new Date(),
    meta: { surface: page },
  });
}

/** 标题回填(仅首个 run:标题为空的行);回填命中即首问——fire-and-forget 入
 * 洞察信号池(M34 批①,完整首问比 title 20 字截断更利于聚类,ingest 自吞异常)。
 * M58 批⑤起按页面上下文过滤后台功能页会话。 */
export async function backfillSessionTitle(
  sessionId: string,
  message: string,
  page?: string | null,
): Promise<void> {
  const r = await prisma.searchAgentSession.updateMany({
    where: { id: sessionId, title: null },
    data: { title: deriveTitle(message) },
  });
  if (r.count > 0) captureAsk(sessionId, message, page);
}

/** 首问判定键 TTL(游客线程活跃 TTL 2h 的两倍余量;键只存 "1") */
const ASK_RECORDED_TTL_SECONDS = 6 * 3600;
const askRecordedKey = (threadId: string): string => `search:agent:ask-recorded:${threadId}`;

/** 游客首问(M58 批⑤):游客不落会话行,run 收尾用 Redis SET NX 判首问。
 * refId=`g:<threadId>`,**不存 visitorId**(不做个人关联);ingest 侧
 * `(source, refId)` 唯一键天然兜住键过期后的重记。Redis 不可用 = 宁可漏记
 * 不误记,直接跳过并留事件。 */
export async function recordGuestFirstAsk(
  threadId: string,
  message: string,
  page?: string | null,
): Promise<void> {
  try {
    const first = await redis.set(
      askRecordedKey(threadId),
      "1",
      "EX",
      ASK_RECORDED_TTL_SECONDS,
      "NX",
    );
    if (first !== "OK") return;
  } catch (e) {
    logger.warn({
      event: "agent.guest_ask_record_failed",
      threadId,
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  captureAsk(`g:${threadId}`, message, page);
}
