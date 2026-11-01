/**
 * 公众号入站落库(M66):渠道用户/消息两表的最小写面。
 *
 * 幂等锚点 = `wechat_msg_id` 唯一索引:微信超时重试会原样重发同一 MsgId,
 * 命中即直接回已存出站(重试天然变成「回捞」),不再二次生成。
 * 出站行键形态 `out:<入站MsgId>:<n>`(n 从 1 起)——首答与「继续」回捞是两条独立出站。
 */
import { isP2002, prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import type { WechatMpAnswerStatus, WechatMpReplyKind } from "./constants";

export interface ChannelUserRow {
  id: bigint;
  userId: bigint | null;
}

/** 渠道用户 get-or-create;返回行含站内绑定 userId(未绑为 null) */
export async function ensureChannelUser(openid: string): Promise<ChannelUserRow> {
  const row = await prisma.channelWechatMpUser.upsert({
    where: { openid },
    create: { openid },
    update: {},
    select: { id: true, userId: true },
  });
  return row;
}

/** 关注/取关状态与最后发言时刻(事件路径) */
export async function updateChannelUser(
  openid: string,
  patch: {
    isSubscribed?: boolean;
    subscribedAt?: Date | null;
    unsubscribedAt?: Date | null;
    lastMessageAt?: Date;
  },
): Promise<void> {
  await prisma.channelWechatMpUser.update({
    where: { openid },
    data: patch,
    select: { id: true },
  });
}

/** 入站消息已存在则返回其 id(重试路径),否则落库并返回新 id */
export async function claimInboundMessage(params: {
  channelUserId: bigint;
  wechatMsgId: string;
  msgType: string;
  event: string | null;
  content: string;
}): Promise<{ id: bigint; duplicate: false } | { id: bigint; duplicate: true }> {
  const existing = await prisma.channelWechatMpMessage.findUnique({
    where: { wechatMsgId: params.wechatMsgId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, duplicate: true };

  try {
    const created = await prisma.channelWechatMpMessage.create({
      data: {
        channelUserId: params.channelUserId,
        wechatMsgId: params.wechatMsgId,
        direction: "in",
        msgType: params.msgType,
        event: params.event,
        content: params.content,
      },
      select: { id: true },
    });
    await prisma.channelWechatMpUser.update({
      where: { id: params.channelUserId },
      data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
      select: { id: true },
    });
    return { id: created.id, duplicate: false };
  } catch (e) {
    // 并发重试撞唯一索引 = 另一个请求已认领
    if (isP2002(e)) {
      const again = await prisma.channelWechatMpMessage.findUnique({
        where: { wechatMsgId: params.wechatMsgId },
        select: { id: true },
      });
      if (again) return { id: again.id, duplicate: true };
    }
    throw e;
  }
}

/** 出站落库(键 `out:<入站MsgId>:<n>`,唯一索引兜底并发) */
export async function saveOutboundMessage(params: {
  channelUserId: bigint;
  inboundMsgId: string;
  content: string;
  replyKind: WechatMpReplyKind;
  answerStatus?: WechatMpAnswerStatus | null;
  latencyMs?: number | null;
}): Promise<void> {
  const prefix = `out:${params.inboundMsgId}:`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const n =
      (await prisma.channelWechatMpMessage.count({
        where: { wechatMsgId: { startsWith: prefix } },
      })) + 1;
    try {
      await prisma.channelWechatMpMessage.create({
        data: {
          channelUserId: params.channelUserId,
          wechatMsgId: `${prefix}${n}`,
          direction: "out",
          msgType: "text",
          content: params.content,
          replyKind: params.replyKind,
          answerStatus: params.answerStatus ?? null,
          latencyMs: params.latencyMs ?? null,
        },
        select: { id: true },
      });
      return;
    } catch (e) {
      if (!isP2002(e)) throw e;
      logger.warn({ event: "wechat_mp.outbound_conflict", key: `${prefix}${n}`, attempt });
    }
  }
  throw new Error(`出站消息落库冲突(msgs=${params.inboundMsgId})`);
}

/** 该入站消息已产出的最后一条出站文本(重试直接回放;无则 null) */
export async function findStoredReply(inboundMsgId: string): Promise<string | null> {
  const row = await prisma.channelWechatMpMessage.findFirst({
    where: { wechatMsgId: { startsWith: `out:${inboundMsgId}:` } },
    orderBy: { id: "desc" },
    select: { content: true },
  });
  return row?.content ?? null;
}

/** 绑定站内账号(一个站内账号只挂一个 openid:先解绑旧行) */
export async function bindChannelUser(openid: string, userId: bigint): Promise<void> {
  await prisma.$transaction([
    prisma.channelWechatMpUser.updateMany({
      where: { userId, NOT: { openid } },
      data: { userId: null },
    }),
    prisma.channelWechatMpUser.update({ where: { openid }, data: { userId } }),
  ]);
}

export async function unbindChannelUser(userId: bigint): Promise<number> {
  const r = await prisma.channelWechatMpUser.updateMany({
    where: { userId },
    data: { userId: null },
  });
  return r.count;
}
