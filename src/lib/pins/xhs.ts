/**
 * 贴图 → 小红书渠道分发(M49 批X1' 定稿:小红书笔记载体 = 贴图,「小绿书」
 * 定位天然同构)。半自动模式:贴图本身即物料(标题/轻文字/图片序列),
 * 发布动作人工(无官方发布 API,plan M49 调研);系统只记账渠道行 + 回填
 * 笔记链接。零 worker 零 LLM——与 pin→公众号(自动同步管线)形态不同。
 */
import path from "node:path";

import { prisma } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { DistributeError } from "../distribute/errors";
import { ensureChannelRowUnique } from "../distribute/channel-row";
import { PUBLISH_STATUS_PENDING, PUBLISH_STATUS_SYNCED } from "../distribute/channels";
import { DISTRIBUTE_JOB_XHS_AUTO, QUEUE_DISTRIBUTE_XHS, getQueue } from "../queue";
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

/** 全自动入队:创建渠道行 + 发布 job 入子队列(worker 调 xhs-gateway) */
export async function enqueueXhsAutoPublish(pinId: bigint): Promise<{ jobId: string }> {
  const row = await distributePinToXhs(pinId);
  const jobId = `xhs-auto-${pinId.toString()}-${Date.now().toString(36)}`;
  await getQueue(QUEUE_DISTRIBUTE_XHS).add(
    DISTRIBUTE_JOB_XHS_AUTO,
    { pinId: pinId.toString() },
    { jobId, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
  );
  logger.info({ event: "pins.xhs.auto_enqueued", jobId, pinId: pinId.toString() });
  return { jobId };
}

/** 登录态录入(抖音同款手动 Cookie 心智,M49 批X3):F12 复制的 cookie 串
 * 转发 xhs-gateway 验证登录并落 storage_state(卷持久化,后续发布免登) */
export async function ingestXhsCookies(cookieHeader: string): Promise<void> {
  const base = process.env.DOUYIN_GATEWAY_URL ?? "http://douyin-gateway:8010";
  const res = await fetch(`${base}/xhs/cookies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cookie_header: cookieHeader }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`登录态录入失败: ${text.slice(0, 200) || res.status}`);
  }
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

/** 发布物料(标题/轻文字/图片容器内绝对路径)——worker 消费侧组装用 */
export interface PinXhsMaterial {
  title: string;
  content: string;
  images: string[];
}

/** 收集贴图发布物料:图片站内 URL → 容器内绝对路径(worker MEDIA_DIR 挂载点) */
export async function gatherPinXhsMaterial(pinId: bigint): Promise<PinXhsMaterial> {
  const pin = await prisma.contentPin.findUnique({
    where: { id: pinId },
    select: {
      title: true,
      content: true,
      images: { orderBy: { sortOrder: "asc" }, select: { mediaPath: true } },
    },
  });
  if (!pin) throw new Error("贴图不存在");
  const images = pin.images.map((img) => {
    // 站内 URL /wp-content/uploads/<key> ↔ $MEDIA_DIR/<key>(storage.ts 路径约定)
    const marker = "/wp-content/uploads/";
    const idx = img.mediaPath.indexOf(marker);
    const key =
      idx >= 0 ? img.mediaPath.slice(idx + marker.length) : img.mediaPath.replace(/^\//, "");
    return path.resolve(env.MEDIA_DIR, decodeURIComponent(key));
  });
  return { title: pin.title, content: pin.content, images };
}

/** 全自动发布:调 xhs-gateway(/xhs/publish)→ 渠道行 synced+noteUrl / failed+lastError */
export async function autoPublishPinToXhs(pinId: bigint): Promise<void> {
  const row = await prisma.contentPinChannel.findUnique({
    where: { pinId_channel: { pinId, channel: CHANNEL_XHS } },
  });
  if (!row) throw new Error("渠道行不存在(先标记分发)");
  try {
    const material = await gatherPinXhsMaterial(pinId);
    const base = process.env.DOUYIN_GATEWAY_URL ?? "http://douyin-gateway:8010";
    const res = await fetch(`${base}/xhs/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: material.title,
        content: material.content,
        images: material.images,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      // gateway 错误体形如 {"detail":"人话"}——解析出人话进 lastError
      const text = await res.text().catch(() => "");
      let reason = text.slice(0, 200);
      try {
        reason = (JSON.parse(text) as { detail?: string }).detail ?? reason;
      } catch {}
      throw new Error(reason || `xhs-gateway ${res.status}`);
    }
    const payload = (await res.json()) as {
      ok?: boolean;
      error?: string;
      note_url?: string | null;
    };
    if (payload.ok !== true) throw new Error(payload.error ?? "发布失败");
    await prisma.contentPinChannel.update({
      where: { id: row.id },
      data: {
        status: PUBLISH_STATUS_SYNCED,
        publishId: payload.note_url ?? "",
        syncedAt: new Date(),
        lastError: null,
        attempts: { increment: 1 },
      },
    });
    console.log(JSON.stringify({ event: "pins.xhs.auto_published", pinId: pinId.toString() }));
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.contentPinChannel
      .update({
        where: { id: row.id },
        data: { status: "failed", lastError: msg, attempts: { increment: 1 } },
      })
      .catch(() => undefined);
    throw e;
  }
}
