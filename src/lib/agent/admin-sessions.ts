/**
 * 后台会话管理读侧(K2.6 需求5;M58 批⑤ 后续游客留档):两类会话一屏可见——
 * - member(admin/user 登录):search_agent_session 行为准(title/tokens/时间),
 *   提问数由 ai_usage_log(role=search_agent,session_id=线程)计数;
 * - guest(游客):run 收尾落**匿名**会话行(visitorId=`guest`,不存访客标识),
 *   行次由 Redis 归属键判定、内容留档 30 天(与成员同口径日清);无行的历史
 *   线程仍按 ai_usage_log 聚合还原统计(标题不可得固定 null)。
 * 两源合并按最近活动倒排,内存分页(行量受 30 天清退约束)。详情读 checkpoint
 * 消息时间线,游客归属键消失只影响「能否继续追问」,不影响留档内容的可读性。
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
  /** member/游客行=首问前 20 字;仅台账无行的历史游客线程恒 null(UI 显「游客会话」) */
  title: string | null;
  /** member=admin:<sub>;guest=visitorId(uuid,归属键在场时)或「游客」 */
  owner: string;
  /** 提问数(= run 台账行数) */
  runs: number;
  tokensTotal: number;
  firstAt: Date;
  lastAt: Date;
  /** guest:Redis 归属键在场即「可继续追问」(null=Redis 不可判);member 恒 null */
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

  const qWhere = q ? { OR: [{ title: { contains: q } }, { id: { contains: q } }] } : {};
  const [memberRows, guestRows, guestAgg] = await Promise.all([
    wantMember
      ? prisma.searchAgentSession.findMany({
          // 游客匿名行也在同表(g_ 前缀),成员视图剔除
          where: { NOT: { id: { startsWith: "g_" } }, ...qWhere },
          orderBy: { lastMessageAt: "desc" },
        })
      : Promise.resolve([]),
    wantGuest
      ? prisma.searchAgentSession.findMany({
          where: { id: { startsWith: "g_" }, ...qWhere },
          select: {
            id: true,
            title: true,
            tokensTotal: true,
            createdAt: true,
            lastMessageAt: true,
          },
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
  // 游客:留档行(标题/时间/tokens)与台账聚合并集——无行的历史线程只靠台账
  const guestRowById = new Map(guestRows.map((r) => [r.id, r]));
  for (const threadId of new Set<string>([...guestAgg.keys(), ...guestRowById.keys()])) {
    // 双保险:LIKE 'g%' 粗筛后前缀精确过滤(成员 uuid 不可能以 g 开头,冗余防御)
    if (!isGuestThreadId(threadId)) continue;
    const agg = guestAgg.get(threadId);
    const row = guestRowById.get(threadId);
    // q 已由 SQL 过滤留档行;仅台账线程退化为 id 包含匹配
    if (q && !row && !threadId.includes(q)) continue;
    merged.push({
      threadId,
      kind: "guest",
      title: row?.title ?? null,
      owner: "游客",
      runs: agg?.runs ?? 0,
      tokensTotal: row?.tokensTotal ?? (agg?.tokensIn ?? 0) + (agg?.tokensOut ?? 0),
      firstAt: row?.createdAt ?? agg?.firstAt ?? agg?.lastAt ?? new Date(0),
      lastAt: row?.lastMessageAt ?? agg?.lastAt ?? agg?.firstAt ?? new Date(0),
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

/** 会话详情:meta 统计 + checkpoint 消息时间线(游客归属键消失仍可读留档) */
export async function getAgentSessionDetail(threadId: string): Promise<AgentSessionDetail | null> {
  if (isGuestThreadId(threadId)) {
    const [agg, owner, row] = await Promise.all([
      aggregateUsage({ equals: threadId }),
      getGuestThreadOwner(threadId).catch(() => null),
      prisma.searchAgentSession.findUnique({
        where: { id: threadId },
        select: {
          title: true,
          tokensTotal: true,
          createdAt: true,
          lastMessageAt: true,
        },
      }),
    ]);
    const usage = agg.get(threadId);
    // 台账/留档行/归属键三者皆无:毫无痕迹 → 404
    if (!usage && owner === null && row === null) return null;
    const live = owner !== null;
    // 内容可读性与归属键解耦:留档期内 checkpoint 在场即出时间线
    const messages = await getThreadMessages(threadId).catch(() => null);
    return {
      meta: {
        threadId,
        kind: "guest",
        title: row?.title ?? null,
        owner: owner ?? "游客",
        runs: usage?.runs ?? 0,
        tokensTotal: row?.tokensTotal ?? (usage?.tokensIn ?? 0) + (usage?.tokensOut ?? 0),
        firstAt: row?.createdAt ?? usage?.firstAt ?? usage?.lastAt ?? new Date(0),
        lastAt: row?.lastMessageAt ?? usage?.lastAt ?? usage?.firstAt ?? new Date(0),
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
