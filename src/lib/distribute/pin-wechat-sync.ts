/**
 * 贴图公众号同步(M41 渠道三「小绿书」图片消息 newspic):
 * 入队口(组装台「同步至公众号草稿箱」)→ QUEUE_DISTRIBUTE(worker 并发 1,
 * 与文章同步共享,微信频控串行)。执行管线:逐张 add_material 换永久 MediaID
 * (publish_media_cache m: 缓存防重传)→ draft/add newspic(首推)| draft/update
 * (重推,行 mediaId 锚定)→ 行状态机 pending→synced/failed,失败可重试。
 * spike 契约锚(2026-10-22 官方文档实证):标题 ≤32 字 / content 纯文本 ≤2 万
 * 码点 / image_list ≤20 张首张即封面 / crop_percent_list 三档 /
 * content_source_url 阅读原文(41039 域名校验被拒时去字段重试一次,同图文口径)。
 */
import { randomUUID } from "node:crypto";

import { prisma } from "../db";
import { logger } from "../logger";
import { DISTRIBUTE_JOB_PIN_WECHAT, getQueue, QUEUE_DISTRIBUTE } from "../queue";
import { CHANNEL_WECHAT, PUBLISH_STATUS_PENDING } from "./channels";
import { DistributeError } from "./errors";
import {
  ensurePinChannelRow,
  markPinChannelFailed,
  markPinChannelPending,
  markPinChannelSynced,
} from "./pin-channel-state";
import { ensureCoverMedia } from "./wechat-media";
import { type WechatCredentials, type WechatNewsPicArticle } from "./wechat-client";
import { requireReadyConfig } from "./wechat-sync";
import { submitWechatDraft } from "./wechat-draft-submit";

export interface PinWechatSyncJobData {
  token: string;
  pinId: string;
}

export interface PinWechatSyncResult {
  ok: boolean;
  pinId: string;
  mediaId?: string;
  reason?: string;
}

/** 渠道留痕行(每贴图×渠道一行;批C 起原语入 pin-channel-state) */
function ensureRow(pinId: bigint) {
  return ensurePinChannelRow(pinId, CHANNEL_WECHAT);
}

/**
 * 入队口(组装台「同步至公众号草稿箱」):资格前置全 400 人话
 * (未配置/草稿未验收/无图片/队列中拒重);通过后渠道行落 pending。
 */
export async function enqueuePinWechatSync(
  pinId: bigint,
): Promise<{ jobId: string; token: string }> {
  await requireReadyConfig();
  const pin = await prisma.contentPin.findUnique({
    where: { id: pinId },
    select: { id: true, status: true, _count: { select: { images: true } } },
  });
  if (!pin) throw new DistributeError("not_found", "贴图不存在");
  if (pin.status === "draft") {
    throw new DistributeError("invalid", "草稿尚未验收:请先提交验收再同步公众号");
  }
  if (pin._count.images === 0) {
    throw new DistributeError("invalid", "缺少图片:公众号图片消息至少需要 1 张图");
  }
  // pending 拒重必须在建行前判(同 enqueueWechatSync 2026-10-07 首单教训):
  // 先建后判会把首推自拒成僵尸 pending 行
  const existing = await prisma.contentPinChannel.findUnique({
    where: { pinId_channel: { pinId, channel: CHANNEL_WECHAT } },
    select: { status: true },
  });
  if (existing?.status === PUBLISH_STATUS_PENDING) {
    throw new DistributeError("pending", "该贴图已在同步队列中,请等待完成后再试");
  }
  const row = await ensureRow(pinId);
  const token = randomUUID();
  const jobId = `pin-wechat-${Date.now().toString(36)}`; // BullMQ jobId 禁冒号
  await getQueue(QUEUE_DISTRIBUTE).add(
    DISTRIBUTE_JOB_PIN_WECHAT,
    { token, pinId: pinId.toString() },
    { jobId, attempts: 2, removeOnComplete: 50, removeOnFail: 50 },
  );
  await markPinChannelPending(row.id);
  logger.info({ event: "pin.sync_enqueued", jobId, pinId: pinId.toString() });
  return { jobId, token };
}

/**
 * newspic 草稿提交统一走 wechat-draft-submit(add/update 分流 + 41039 去阅读
 * 原文重试一次,M48 批D-2 收口);事件名保留 pin 前缀,日志面不破。
 */
async function submitNewsPic(
  creds: WechatCredentials,
  article: WechatNewsPicArticle,
  updateMediaId: string | null,
): Promise<string> {
  return submitWechatDraft(creds, article, updateMediaId, "pin.source_url_dropped");
}
async function failSync(pinId: bigint, reason: string): Promise<PinWechatSyncResult> {
  await markPinChannelFailed(pinId, CHANNEL_WECHAT, reason);
  return { ok: false, pinId: pinId.toString(), reason };
}

/** 单贴同步全管线(worker 消费):失败落行返回 false,成功落 synced */
export async function syncOnePin(pinId: bigint): Promise<PinWechatSyncResult> {
  const id = pinId.toString();
  const cfg = await requireReadyConfig(); // 抛 DistributeError → catch 落 failed
  const pin = await prisma.contentPin.findUnique({
    where: { id: pinId },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
  if (!pin) return { ok: false, pinId: id, reason: "贴图不存在" };
  const row = await ensureRow(pinId);
  try {
    if (pin.images.length === 0) {
      return await failSync(pinId, "缺少图片:公众号图片消息至少需要 1 张图");
    }
    if ([...pin.title].length > 32) {
      return await failSync(pinId, `标题 ${[...pin.title].length} 字超过图片消息上限 32`);
    }
    const contentChars = [...pin.content].length;
    if (contentChars > 20000) {
      return await failSync(pinId, `轻文字 ${contentChars} 码点超过微信上限 20000`);
    }
    const creds: WechatCredentials = { appid: cfg.appid, appSecret: cfg.appSecret };
    // 逐张永久素材(add_material;uploadimg 的 URL 不可用于 image_list)——
    // m:sha1 缓存命中零重传;任一张失败整单终止(裂图比不同步更糟)
    const imageList: Array<{ image_media_id: string }> = [];
    for (const img of pin.images) {
      const material = await ensureCoverMedia(creds, img.mediaPath);
      imageList.push({ image_media_id: material.mediaId });
    }
    const article: WechatNewsPicArticle = {
      article_type: "newspic",
      title: pin.title,
      content: pin.content,
      ...(cfg.author ? { author: cfg.author } : {}),
      ...(pin.readMoreUrl ? { content_source_url: pin.readMoreUrl } : {}),
      image_info: { image_list: imageList },
      cover_info: { crop_percent_list: [{ ratio: pin.cropSpec }] },
    };
    // 阅读原文(read_more_url)由组装台显式维护,缺省不带(不擅自覆盖导流)
    const mediaId = await submitNewsPic(creds, article, row.mediaId);

    await prisma.$transaction(async (tx) => {
      await markPinChannelSynced(row.id, { mediaId }, tx);
      // pending→synced;已发布保持 published(重推草稿不动站点态);draft 不可能入队
      await tx.contentPin.update({
        where: { id: pinId },
        data: {
          ...(pin.status === "pending" ? { status: "synced" } : {}),
          syncedAt: new Date(),
        },
      });
    });
    logger.info({
      event: "pin.synced",
      pinId: id,
      mediaId,
      updated: Boolean(row.mediaId),
      images: imageList.length,
    });
    return { ok: true, pinId: id, mediaId };
  } catch (e) {
    return failSync(pinId, (e instanceof Error ? e.message : String(e)).slice(0, 500));
  }
}

/** worker 消费:结果已落行;失败上抛给 BullMQ(attempts 2 兜底瞬态抖动) */
export async function pinWechatSyncJob(data: PinWechatSyncJobData): Promise<PinWechatSyncResult> {
  const r = await syncOnePin(BigInt(data.pinId));
  if (!r.ok) throw new Error(r.reason ?? "贴图同步失败");
  return r;
}
