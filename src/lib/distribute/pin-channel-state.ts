/**
 * 贴图渠道行状态机公共段(M50 批C 自 pin-wechat-sync 与 pins/xhs 收口):
 * contentPinChannel 的 ensure / pending 复位 / synced 落账 / failed 落账
 * 四段原语——两渠道此前逐行复制(四段全同构)。差异不进原语:锚字段由
 * 调用方给(mediaId=公众号草稿 | publishId=小红书笔记),重试策略在各自
 * 入队(job opts),主行联动(公众号同步推进贴图主行,小红书不动)留在
 * pin-wechat-sync 的事务里。
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { logger } from "../logger";

import { PUBLISH_STATUS_FAILED, PUBLISH_STATUS_PENDING, PUBLISH_STATUS_SYNCED } from "./channels";
import { ensureChannelRowUnique } from "./channel-row";

/** 渠道留痕行(每贴图×渠道一行;P2002 兜底走 channel-row 统一口) */
export function ensurePinChannelRow(pinId: bigint, channel: string) {
  return ensureChannelRowUnique(
    () =>
      prisma.contentPinChannel.findUnique({
        where: { pinId_channel: { pinId, channel } },
      }),
    () => prisma.contentPinChannel.create({ data: { pinId, channel } }),
  );
}

/** 入队/重发前置:行复位 pending 清 lastError(xhs failed 复位;wechat 入队后置) */
export async function markPinChannelPending(rowId: bigint): Promise<void> {
  await prisma.contentPinChannel.update({
    where: { id: rowId },
    data: { status: PUBLISH_STATUS_PENDING, lastError: null },
  });
}

/** 成功落账:锚字段按渠道给(缺省不动该列);attempts 计数。
 * tx 参数供公众号同步的主行联动事务复用(批C 前该段写在事务数组里)。 */
export async function markPinChannelSynced(
  rowId: bigint,
  anchor: { mediaId?: string; publishId?: string },
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.contentPinChannel.update({
    where: { id: rowId },
    data: {
      status: PUBLISH_STATUS_SYNCED,
      syncedAt: new Date(),
      lastError: null,
      attempts: { increment: 1 },
      ...(anchor.mediaId !== undefined ? { mediaId: anchor.mediaId } : {}),
      ...(anchor.publishId !== undefined ? { publishId: anchor.publishId } : {}),
    },
  });
}

/** 失败落账(worker 单点承担,防 attempts 双计数;人话截 500)。
 * updateMany 按 pinId+channel 定位:调用方无行句柄(物料阶段早败)也能落。 */
export async function markPinChannelFailed(
  pinId: bigint,
  channel: string,
  reason: string,
): Promise<void> {
  await prisma.contentPinChannel.updateMany({
    where: { pinId, channel },
    data: {
      status: PUBLISH_STATUS_FAILED,
      lastError: reason.slice(0, 500),
      attempts: { increment: 1 },
    },
  });
  logger.warn({
    event: "pin.channel_failed",
    pinId: pinId.toString(),
    channel,
    error: reason.slice(0, 200),
  });
}
