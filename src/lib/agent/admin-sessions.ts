/**
 * 后台会话管理读侧(K2.6 需求5):两类会话一屏可见——
 * - member(admin 登录):search_agent_session 行为准(title/tokens/时间),
 *   提问数由 ai_usage_log(role=search_agent,session_id=线程)计数;
 * - guest(游客,不落行):ai_usage_log 按 session_id(LIKE 'g%',成员 id 为
 *   uuid 首字符必为 hex,不会撞 g 前缀)聚合还原统计视图,标题不可得固定
 *   null(UI 显「游客会话」),活跃态查 Redis 归属键。
 * 两源合并按最近活动倒排,内存分页(admin 会话 20/日/人 + 游客键 2h 清,
 * distinct 量级小)。详情读 checkpoint 消息时间线,游客过期标注不返消息。
 */
import type { BaseMessage } from "@langchain/core/messages";

import { AI_USAGE_ROLE_SEARCH_AGENT } from "@/lib/ai/usage-log";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

import { getThreadMessages } from "./checkpointer";
import { getGuestThreadOwner, guestThreadKey, isGuestThreadId } from "./guest-threads";
import { serializeWireMessage, type WireMessage } from "./wire";

export const AGENT_SESSION_KINDS = ["all", "member", "guest"] as const;
export type AgentSessionKindFilter = (typeof AGENT_SESSION_KINDS)[number];

export type AgentSessionKind = "member" | "guest";

export const AGENT_SESSIONS_PAGE_SIZE = 15;

export interface AdminAgentSessionRow {
  threadId: string;
  kind: AgentSessionKind;
  /** member=首问前 20 字;guest 恒 null(UI 显「游客会话」) */
  title: string | null;
  /** member=admin:<sub>;guest=visitorId(uuid) */
  owner: string;
  /** 提问数(= run 台账行数) */
  runs: number;
  tokensTotal: number;
  firstAt: Date;
  lastAt: Date;
  /** guest:Redis 归属键在场(null=Redis 不可判);member 恒 null(UI 显「在档」) */
  live: boolean | null;
}

export interface AgentSessionListQuery {
  page: number;
  kind: AgentSessionKindFilter;
  q?: string;
}

interface UsageAgg {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

/** 台账按 session_id 聚合(role 固定 search_agent;startsWith "g" 只圈游客行) */
async function aggregateUsage(sessionIdFilter: {
  startsWith?: string;
  equals?: string;
}): Promise<Map<string, UsageAgg>> {
  const rows = await prisma.aiUsageLog.groupBy({
    by: ["sessionId"],
    where: {
      role: AI_USAGE_ROLE_SEARCH_AGENT,
      sessionId: { startsWith: sessionIdFilter.startsWith, equals: sessionIdFilter.equals },
    },
    _count: { _all: true },
    _sum: { tokensIn: true, tokensOut: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });
  const map = new Map<string, UsageAgg>();
  for (const r of rows) {
    if (!r.sessionId) continue;
    map.set(r.sessionId, {
      runs: r._count._all,
      tokensIn: r._sum.tokensIn ?? 0,
      tokensOut: r._sum.tokensOut ?? 0,
      firstAt: r._min.createdAt,
      lastAt: r._max.createdAt,
    });
  }
  return map;
}

/** 游客列表行活跃态:归属键在场即活跃;Redis 异常不反噬(显「—」) */
async function guestLive(threadId: string): Promise<boolean | null> {
  try {
    return (await redis.exists(guestThreadKey(threadId))) === 1;
  } catch {
    return null;
  }
}

/** 会话列表(kind=all 合并两源;内存分页,按最近活动倒排) */
export async function listAgentSessionsAdmin({ page, kind, q }: AgentSessionListQuery): Promise<{
  items: AdminAgentSessionRow[];
  total: number;
  page: number;
  kind: AgentSessionKindFilter;
  counts: { all: number; member: number; guest: number };
}> {
  const wantMember = kind === "all" || kind === "member";
  const wantGuest = kind === "all" || kind === "guest";

  const [memberRows, guestAgg] = await Promise.all([
    wantMember
      ? prisma.searchAgentSession.findMany({
          where: q ? { OR: [{ title: { contains: q } }, { id: { contains: q } }] } : {},
          orderBy: { lastMessageAt: "desc" },
        })
      : Promise.resolve([]),
    wantGuest ? aggregateUsage({ startsWith: "g" }) : Promise.resolve(new Map<string, UsageAgg>()),
  ]);

  const merged: AdminAgentSessionRow[] = [];
  // member 行 runs 数:同一张台账补一次按 id 集合的聚合(tokens 以行内累计为准)
  if (memberRows.length > 0) {
    const memberAgg = await aggregateUsageByIds(memberRows.map((r) => r.id));
    for (const r of memberRows) {
      const agg = memberAgg.get(r.id);
      merged.push({
        threadId: r.id,
        kind: "member",
        title: r.title,
        owner: r.visitorId,
        runs: agg?.runs ?? 0,
        tokensTotal: r.tokensTotal,
        firstAt: r.createdAt,
        lastAt: r.lastMessageAt,
        live: null,
      });
    }
  }
  for (const [threadId, agg] of guestAgg) {
    // 双保险:LIKE 'g%' 粗筛后前缀精确过滤(成员 uuid 不可能以 g 开头,冗余防御)
    if (!isGuestThreadId(threadId)) continue;
    if (q && !threadId.includes(q)) continue;
    merged.push({
      threadId,
      kind: "guest",
      title: null,
      owner: "游客",
      runs: agg.runs,
      tokensTotal: agg.tokensIn + agg.tokensOut,
      firstAt: agg.firstAt ?? agg.lastAt ?? new Date(0),
      lastAt: agg.lastAt ?? agg.firstAt ?? new Date(0),
      live: null,
    });
  }

  // q 对 member 命中已由 SQL 过滤;合并后统一按最近活动倒排
  merged.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());

  const counts = {
    all: merged.length,
    member: merged.filter((r) => r.kind === "member").length,
    guest: merged.filter((r) => r.kind === "guest").length,
  };
  const paged = merged.slice(
    (page - 1) * AGENT_SESSIONS_PAGE_SIZE,
    page * AGENT_SESSIONS_PAGE_SIZE,
  );

  // 活跃态只查当前页(≤15 次 Redis exists),避免全量 N 次往返
  await Promise.all(
    paged.map(async (row) => {
      if (row.kind === "guest") row.live = await guestLive(row.threadId);
    }),
  );

  return { items: paged, total: merged.length, page, kind, counts };
}

/** member 行 runs 计数(sessionId in 集合;aggregateUsage 的 equals 版复用聚合形状) */
async function aggregateUsageByIds(ids: string[]): Promise<Map<string, UsageAgg>> {
  const rows = await prisma.aiUsageLog.groupBy({
    by: ["sessionId"],
    where: { role: AI_USAGE_ROLE_SEARCH_AGENT, sessionId: { in: ids } },
    _count: { _all: true },
    _sum: { tokensIn: true, tokensOut: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });
  const map = new Map<string, UsageAgg>();
  for (const r of rows) {
    if (!r.sessionId) continue;
    map.set(r.sessionId, {
      runs: r._count._all,
      tokensIn: r._sum.tokensIn ?? 0,
      tokensOut: r._sum.tokensOut ?? 0,
      firstAt: r._min.createdAt,
      lastAt: r._max.createdAt,
    });
  }
  return map;
}

export interface AgentSessionDetail {
  meta: AdminAgentSessionRow;
  /** checkpoint 不可读(游客过期被清/线程已被删)→ true,前端标「已过期」 */
  expired: boolean;
  /** 扁平 wire 消息(expired 时为 null) */
  messages: WireMessage[] | null;
}

/** 会话详情:meta 统计 + checkpoint 消息时间线(guest 过期只给 meta) */
export async function getAgentSessionDetail(threadId: string): Promise<AgentSessionDetail | null> {
  if (isGuestThreadId(threadId)) {
    const [agg, owner] = await Promise.all([
      aggregateUsage({ equals: threadId }),
      getGuestThreadOwner(threadId).catch(() => null),
    ]);
    const usage = agg.get(threadId);
    // 台账无行且归属键不在:既无统计也无痕迹 → 404
    if (!usage && owner === null) return null;
    const live = owner !== null;
    // 活跃游客同样可看时间线(checkpoint 在场);过期/键失只留台账统计
    const messages = live ? await getThreadMessages(threadId).catch(() => null) : null;
    return {
      meta: {
        threadId,
        kind: "guest",
        title: null,
        owner: owner ?? "游客",
        runs: usage?.runs ?? 0,
        tokensTotal: (usage?.tokensIn ?? 0) + (usage?.tokensOut ?? 0),
        firstAt: usage?.firstAt ?? usage?.lastAt ?? new Date(0),
        lastAt: usage?.lastAt ?? usage?.firstAt ?? new Date(0),
        live,
      },
      expired: messages === null,
      messages:
        messages === null ? null : messages.map((m) => serializeWireMessage(m as BaseMessage)),
    };
  }

  const row = await prisma.searchAgentSession.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      visitorId: true,
      title: true,
      tokensTotal: true,
      createdAt: true,
      lastMessageAt: true,
    },
  });
  if (!row) return null;
  const agg = await aggregateUsageByIds([threadId]);
  const usage = agg.get(threadId);
  const meta: AdminAgentSessionRow = {
    threadId: row.id,
    kind: "member",
    title: row.title,
    owner: row.visitorId,
    runs: usage?.runs ?? 0,
    tokensTotal: row.tokensTotal,
    firstAt: row.createdAt,
    lastAt: row.lastMessageAt,
    live: null,
  };
  const messages = await getThreadMessages(threadId).catch(() => null);
  if (messages === null) {
    logger.warn({ event: "agent.admin_session_checkpoint_missing", threadId });
    return { meta, expired: true, messages: null };
  }
  return {
    meta,
    expired: false,
    messages: messages.map((m) => serializeWireMessage(m as BaseMessage)),
  };
}
