/**
 * 人工答复队列(M66 转人工闭环)。
 *
 * 认证订阅号没有客服消息权限(微信 48001),无法在用户不说话时主动推送——
 * 站长的答复只能寄存在 `channel_wechat_mp_user.manual_reply` 上,等用户下次
 * 发言时由被动回复**带出一次**,然后清空。这是平台硬约束下的取舍,不是设计偏好:
 * 真正的实时客服要走微信客服(需企业主体),见 arch/05 §4.10。
 *
 * 三个写面各自的责任:
 * - save:后台保存/覆盖(一次只留一条,重写即替换);
 * - clear:后台撤销;
 * - take:入站投递(原子取走,并发第二个请求拿不到;顺带把 open 线索标 replied)。
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import { WECHAT_MP_MANUAL_REPLY_TTL_SECONDS } from "./constants";

const TTL_MS = WECHAT_MP_MANUAL_REPLY_TTL_SECONDS * 1000;

/** 保存人工答复(空串视为非法,撤销请走 clearManualReply) */
export async function saveManualReply(
  channelUserId: bigint,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = text.trim();
  if (!body) return { ok: false, error: "答复内容不能为空" };
  const r = await prisma.channelWechatMpUser.updateMany({
    where: { id: channelUserId },
    data: { manualReply: body, manualReplyAt: new Date() },
  });
  if (r.count === 0) return { ok: false, error: "会话不存在" };
  logger.info({ event: "wechat_mp.manual_reply_saved", channelUserId: channelUserId.toString() });
  return { ok: true };
}

/** 撤销待投递答复(幂等:本来就没有也算成功) */
export async function clearManualReply(channelUserId: bigint): Promise<void> {
  await prisma.channelWechatMpUser.updateMany({
    where: { id: channelUserId },
    data: { manualReply: null, manualReplyAt: null },
  });
}

/**
 * 取走待投递答复(入站链路调用)。
 *
 * 已过期(超过 TTL 用户都没再说话)则静默作废并返回 null——此时用户刚发的
 * 是一条**新问题**,拿陈年答复糊上去比不答更糟,正常走后续链路即可。
 *
 * 清空用「读到的原文」做条件更新,保证同一条答复只会被投递一次;
 * 后台在间隙里改写了答复则本次放弃(交给下一次),不会发出半新半旧的文本。
 */
export async function takeManualReply(channelUserId: bigint): Promise<string | null> {
  const row = await prisma.channelWechatMpUser.findUnique({
    where: { id: channelUserId },
    select: { manualReply: true, manualReplyAt: true },
  });
  const reply = row?.manualReply;
  if (!reply) return null;

  if (Date.now() - (row?.manualReplyAt?.getTime() ?? 0) > TTL_MS) {
    await clearManualReply(channelUserId);
    logger.info({
      event: "wechat_mp.manual_reply_expired",
      channelUserId: channelUserId.toString(),
    });
    return null;
  }

  const cleared = await prisma.channelWechatMpUser.updateMany({
    where: { id: channelUserId, manualReply: reply },
    data: { manualReply: null, manualReplyAt: null },
  });
  if (cleared.count === 0) return null;

  // 答复已送达 ⇒ 该用户的待回复线索转为「已回复待处置」(后台据此判断还需不需要动作)
  await prisma.channelWechatMpLead.updateMany({
    where: { channelUserId, status: "open" },
    data: { status: "replied" },
  });
  logger.info({
    event: "wechat_mp.manual_reply_delivered",
    channelUserId: channelUserId.toString(),
  });
  return reply;
}
