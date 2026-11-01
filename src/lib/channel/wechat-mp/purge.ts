/**
 * 公众号消息明细日清(M66,plan §6.3 存储策略)。
 *
 * 只清**明细**(channel_wechat_mp_message),渠道用户表(channel_wechat_mp_user)
 * 是聚合行、不随明细删除——会话页的历史口径按用户留存,明细按 180 天滚动。
 * 线索表(channel_wechat_mp_lead)是待办,不清;它引用被删消息时 FK SET NULL。
 */
import { prisma } from "@/lib/db";

import { WECHAT_MP_RETENTION_DAYS } from "./constants";

/** 删除早于保留期的入站/出站消息行,返回删除条数 */
export async function purgeWechatMpMessages(
  days: number = WECHAT_MP_RETENTION_DAYS,
): Promise<{ deleted: number; cutoff: string }> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const r = await prisma.channelWechatMpMessage.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: r.count, cutoff: cutoff.toISOString() };
}
