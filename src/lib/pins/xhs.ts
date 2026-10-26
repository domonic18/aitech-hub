/**
 * 贴图 → 小红书渠道分发(M49 批X1' 定稿:小红书笔记载体 = 贴图,「小绿书」
 * 定位天然同构)。半自动模式:贴图本身即物料(标题/轻文字/图片序列),
 * 发布动作人工(无官方发布 API,plan M49 调研);系统只记账渠道行 + 回填
 * 笔记链接。零 worker 零 LLM——与 pin→公众号(自动同步管线)形态不同。
 */
import { prisma } from "../db";
import { DistributeError } from "../distribute/errors";
import { ensureChannelRowUnique } from "../distribute/channel-row";
import { PUBLISH_STATUS_PENDING, PUBLISH_STATUS_SYNCED } from "../distribute/channels";
// 贴图渠道枚举独立于文章侧 PUBLISH_CHANNELS(贴图载体:xiaohongshu 不入文章分发枚举)
const CHANNEL_XHS = "xiaohongshu";

/** 标记分发到小红书:创建渠道行(pending=已分发待人工发布)。幂等:已存在
 * 直接返回既存行(发布是人工动作,重复标记无意义但不害)。 */
export async function distributePinToXhs(pinId: bigint) {
  const pin = await prisma.contentPin.findUnique({
    where: { id: pinId },
    select: { status: true },
  });
  if (!pin) throw new DistributeError("not_found", "贴图不存在");
  if (pin.status === "draft") {
    throw new DistributeError("invalid", "草稿尚未验收:先提交验收再分发小红书");
  }
  return ensureChannelRowUnique(
    () =>
      prisma.contentPinChannel.findUnique({
        where: { pinId_channel: { pinId, channel: CHANNEL_XHS } },
      }),
    () => prisma.contentPinChannel.create({ data: { pinId, channel: CHANNEL_XHS } }),
  );
}

/** 笔记链接回填(人工发布确认):pending → synced,publishId 落笔记链接 */
export async function backfillXhsNote(pinId: bigint, noteUrl: string): Promise<void> {
  let host = "";
  try {
    host = new URL(noteUrl).hostname;
  } catch {
    throw new DistributeError("invalid", "笔记链接格式无效");
  }
  if (!host.endsWith("xiaohongshu.com")) {
    throw new DistributeError("invalid", "仅接受 xiaohongshu.com 域名的笔记链接");
  }
  const row = await prisma.contentPinChannel.findUnique({
    where: { pinId_channel: { pinId, channel: CHANNEL_XHS } },
  });
  if (!row) throw new DistributeError("not_found", "尚未分发到小红书(先标记分发)");
  if (row.status === PUBLISH_STATUS_SYNCED && row.publishId === noteUrl) return; // 幂等
  await prisma.contentPinChannel.update({
    where: { id: row.id },
    data: {
      status: PUBLISH_STATUS_SYNCED,
      publishId: noteUrl,
      syncedAt: new Date(),
      lastError: null,
    },
  });
}
