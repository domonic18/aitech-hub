/**
 * 公众号会话后台读写(M66,plan §4「会话 / 关键词」)。
 *
 * 只做后台需要的读面与两处写面(线索处置、关键词增改删):
 * - 会话列表按 openid 维度聚合,带最近一条消息摘要——后台第一眼要判断「谁在问、
 *   问什么、有没有待处理线索」,不是看审计流水;
 * - 明细页给完整时间轴(入站/出站各一行)+ 线索区,一屏内能处置;
 * - 关键词是旧服务的主流量入口(单一关键词占 75%),必须在后台可维护。
 *
 * 不做:向量/统计卷、批量导出、消息删除(明细只由 180 天日清滚动)。
 */
import { isP2002, prisma } from "@/lib/db";

export type SessionStatus = "all" | "pending" | "bound" | "unsubscribed";

export const SESSION_PAGE_SIZE = 20;

export interface SessionListRow {
  id: string;
  openid: string;
  displayName: string;
  isSubscribed: boolean;
  isManualPending: boolean;
  boundUserId: string | null;
  boundUserName: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  lastContent: string | null;
  lastDirection: string | null;
  lastReplyKind: string | null;
}

export interface SessionListResult {
  items: SessionListRow[];
  total: number;
  page: number;
  pageSize: number;
}

function boundName(
  u: {
    nickname: string | null;
    username: string | null;
    email: string | null;
  } | null,
): string | null {
  if (!u) return null;
  return u.nickname ?? u.username ?? u.email ?? null;
}

/** 会话列表(按最后发言时间倒序;q 匹配 openid / 昵称 / 绑定账号名) */
export async function listSessionsAdmin(params: {
  page?: number;
  q?: string;
  status?: SessionStatus;
}): Promise<SessionListResult> {
  const page = Math.max(1, params.page ?? 1);
  const q = (params.q ?? "").trim();
  const status: SessionStatus = params.status ?? "all";

  const where = {
    ...(status === "pending" ? { isManualPending: true } : {}),
    ...(status === "unsubscribed" ? { isSubscribed: false } : {}),
    ...(status === "bound" ? { userId: { not: null } } : {}),
    ...(q
      ? {
          OR: [
            { openid: { contains: q, mode: "insensitive" as const } },
            { nickname: { contains: q, mode: "insensitive" as const } },
            {
              user: {
                is: {
                  OR: [
                    { username: { contains: q, mode: "insensitive" as const } },
                    { email: { contains: q, mode: "insensitive" as const } },
                    { nickname: { contains: q, mode: "insensitive" as const } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.channelWechatMpUser.count({ where }),
    prisma.channelWechatMpUser.findMany({
      where,
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * SESSION_PAGE_SIZE,
      take: SESSION_PAGE_SIZE,
      select: {
        id: true,
        openid: true,
        nickname: true,
        isSubscribed: true,
        isManualPending: true,
        lastMessageAt: true,
        messageCount: true,
        userId: true,
        user: { select: { nickname: true, username: true, email: true } },
      },
    }),
  ]);

  const items: SessionListRow[] = await Promise.all(
    rows.map(async (row) => {
      const last = await prisma.channelWechatMpMessage.findFirst({
        where: { channelUserId: row.id },
        orderBy: { createdAt: "desc" },
        select: { content: true, direction: true, replyKind: true },
      });
      return {
        id: row.id.toString(),
        openid: row.openid,
        displayName: row.nickname ?? `访客 ${row.openid.slice(-6)}`,
        isSubscribed: row.isSubscribed,
        isManualPending: row.isManualPending,
        boundUserId: row.userId?.toString() ?? null,
        boundUserName: boundName(row.user),
        lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
        messageCount: row.messageCount,
        lastContent: last?.content.slice(0, 120) ?? null,
        lastDirection: last?.direction ?? null,
        lastReplyKind: last?.replyKind ?? null,
      };
    }),
  );

  return { items, total, page, pageSize: SESSION_PAGE_SIZE };
}

export interface SessionMessageRow {
  id: string;
  direction: string;
  msgType: string;
  event: string | null;
  content: string;
  replyKind: string | null;
  answerStatus: string | null;
  latencyMs: number | null;
  aiUsageId: string | null;
  createdAt: string;
}

export interface SessionLeadRow {
  id: string;
  reason: string;
  status: string;
  note: string | null;
  handledAt: string | null;
  createdAt: string;
  messageId: string | null;
}

export interface SessionDetail {
  user: {
    id: string;
    openid: string;
    nickname: string | null;
    isSubscribed: boolean;
    isManualPending: boolean;
    messageCount: number;
    subscribedAt: string | null;
    unsubscribedAt: string | null;
    lastMessageAt: string | null;
    boundUserId: string | null;
    boundUserName: string | null;
    /** 待投递人工答复(用户下次发言时自动发出);null=队列空 */
    manualReply: string | null;
    manualReplyAt: string | null;
  };
  messages: SessionMessageRow[];
  leads: SessionLeadRow[];
}

/** 会话明细(时间轴上限 200 条,足够覆盖一次处置上下文) */
export async function getSessionAdmin(id: bigint): Promise<SessionDetail | null> {
  const user = await prisma.channelWechatMpUser.findUnique({
    where: { id },
    select: {
      id: true,
      openid: true,
      nickname: true,
      isSubscribed: true,
      isManualPending: true,
      messageCount: true,
      subscribedAt: true,
      unsubscribedAt: true,
      lastMessageAt: true,
      userId: true,
      manualReply: true,
      manualReplyAt: true,
      user: { select: { nickname: true, username: true, email: true } },
    },
  });
  if (!user) return null;

  const [messages, leads] = await Promise.all([
    prisma.channelWechatMpMessage.findMany({
      where: { channelUserId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        direction: true,
        msgType: true,
        event: true,
        content: true,
        replyKind: true,
        answerStatus: true,
        latencyMs: true,
        aiUsageId: true,
        createdAt: true,
      },
    }),
    prisma.channelWechatMpLead.findMany({
      where: { channelUserId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        reason: true,
        status: true,
        note: true,
        handledAt: true,
        createdAt: true,
        messageId: true,
      },
    }),
  ]);

  return {
    user: {
      id: user.id.toString(),
      openid: user.openid,
      nickname: user.nickname,
      isSubscribed: user.isSubscribed,
      isManualPending: user.isManualPending,
      messageCount: user.messageCount,
      subscribedAt: user.subscribedAt?.toISOString() ?? null,
      unsubscribedAt: user.unsubscribedAt?.toISOString() ?? null,
      lastMessageAt: user.lastMessageAt?.toISOString() ?? null,
      boundUserId: user.userId?.toString() ?? null,
      boundUserName: boundName(user.user),
      manualReply: user.manualReply,
      manualReplyAt: user.manualReplyAt?.toISOString() ?? null,
    },
    messages: messages.map((m) => ({
      id: m.id.toString(),
      direction: m.direction,
      msgType: m.msgType,
      event: m.event,
      content: m.content,
      replyKind: m.replyKind,
      answerStatus: m.answerStatus,
      latencyMs: m.latencyMs,
      aiUsageId: m.aiUsageId?.toString() ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
    leads: leads.map((l) => ({
      id: l.id.toString(),
      reason: l.reason,
      status: l.status,
      note: l.note,
      handledAt: l.handledAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      messageId: l.messageId?.toString() ?? null,
    })),
  };
}

/**
 * 处置线索:标记 handled + 备注;该用户没有其他未处置线索(open=待回复 /
 * replied=人工答复已送达待处置)时同时解除 `is_manual_pending`
 * ——列表页的待办角标才不会挂死。
 */
export async function resolveLead(
  leadId: bigint,
  note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const lead = await prisma.channelWechatMpLead.findUnique({
    where: { id: leadId },
    select: { channelUserId: true },
  });
  if (!lead) return { ok: false, error: "线索不存在" };

  await prisma.$transaction(async (tx) => {
    await tx.channelWechatMpLead.update({
      where: { id: leadId },
      data: { status: "handled", note: note.trim() || null, handledAt: new Date() },
    });
    const open = await tx.channelWechatMpLead.count({
      where: { channelUserId: lead.channelUserId, status: { in: ["open", "replied"] } },
    });
    if (open === 0) {
      await tx.channelWechatMpUser.update({
        where: { id: lead.channelUserId },
        data: { isManualPending: false },
      });
    }
  });
  return { ok: true };
}

// ── 关键词 ────────────────────────────────────────────────────────────────

export interface KeywordRow {
  id: string;
  keyword: string;
  postId: string | null;
  postTitle: string | null;
  replyText: string | null;
  isEnabled: boolean;
  hitCount: number;
  updatedAt: string;
}

export async function listKeywordsAdmin(): Promise<KeywordRow[]> {
  const rows = await prisma.channelWechatMpKeyword.findMany({
    orderBy: [{ hitCount: "desc" }, { id: "asc" }],
    select: {
      id: true,
      keyword: true,
      postId: true,
      replyText: true,
      isEnabled: true,
      hitCount: true,
      updatedAt: true,
      post: { select: { title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id.toString(),
    keyword: r.keyword,
    postId: r.postId?.toString() ?? null,
    postTitle: r.post?.title ?? null,
    replyText: r.replyText,
    isEnabled: r.isEnabled,
    hitCount: r.hitCount,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface KeywordInput {
  keyword: string;
  postId?: string | null;
  replyText?: string | null;
  isEnabled?: boolean;
}

function toPostId(postId: string | null | undefined): bigint | null {
  if (!postId) return null;
  try {
    return BigInt(postId);
  } catch {
    return null;
  }
}

export async function createKeyword(
  input: KeywordInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const keyword = input.keyword.trim();
  if (!keyword) return { ok: false, error: "关键词不能为空" };
  try {
    const row = await prisma.channelWechatMpKeyword.create({
      data: {
        keyword,
        postId: toPostId(input.postId),
        replyText: input.replyText?.trim() || null,
        isEnabled: input.isEnabled ?? true,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id.toString() };
  } catch (e) {
    if (isP2002(e)) return { ok: false, error: "关键词已存在(唯一)" };
    throw e;
  }
}

export async function updateKeyword(
  id: bigint,
  input: KeywordInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const keyword = input.keyword.trim();
  if (!keyword) return { ok: false, error: "关键词不能为空" };
  try {
    await prisma.channelWechatMpKeyword.update({
      where: { id },
      data: {
        keyword,
        postId: toPostId(input.postId),
        replyText: input.replyText?.trim() || null,
        ...(input.isEnabled === undefined ? {} : { isEnabled: input.isEnabled }),
      },
    });
    return { ok: true };
  } catch (e) {
    if (isP2002(e)) return { ok: false, error: "关键词已存在(唯一)" };
    if ((e as { code?: string }).code === "P2025") return { ok: false, error: "关键词不存在" };
    throw e;
  }
}

export async function deleteKeyword(
  id: bigint,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await prisma.channelWechatMpKeyword.deleteMany({ where: { id } });
  return r.count > 0 ? { ok: true } : { ok: false, error: "关键词不存在" };
}
