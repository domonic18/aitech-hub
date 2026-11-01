/**
 * 贴图 → 小红书渠道分发(M49 定稿:小红书笔记载体 = 贴图,「小绿书」定位
 * 天然同构)。全自动发布:贴图本身即物料(标题/轻文字/图片序列)直发,
 * 无 LLM 改写;入队 worker 子队列 → gateway Playwright 创作平台发布
 * (无官方发布 API,plan M49 调研)。登录态经后台分发中心渠道卡粘贴
 * Cookie 录入(gateway 验证落 storage_state)。零人工流程:失败自动重试
 * 3 次,终态 failed 后界面「重新发布」重新入队。
 */
import path from "node:path";
import { douyinGatewayBase } from "@/lib/config/gateways";

import { prisma } from "../db";
import { logInfo, logger } from "../logger";
import { mediaStorage } from "../media/storage";
import { DistributeError } from "../distribute/errors";
import {
  ensurePinChannelRow,
  markPinChannelPending,
  markPinChannelSynced,
} from "../distribute/pin-channel-state";
import { CHANNEL_XHS, PUBLISH_STATUS_FAILED, PUBLISH_STATUS_SYNCED } from "../distribute/channels";
import { DISTRIBUTE_JOB_XHS_AUTO, QUEUE_DISTRIBUTE_XHS, getQueue } from "../queue";

/** 创建/复用渠道行(pending;验收门槛:草稿拒)。幂等,仅供本模块入队使用。 */
async function distributePinToXhs(pinId: bigint) {
  const pin = await prisma.contentPin.findUnique({
    where: { id: pinId },
    select: { status: true },
  });
  if (!pin) throw new DistributeError("not_found", "贴图不存在");
  if (pin.status === "draft") {
    throw new DistributeError("invalid", "草稿尚未验收:先提交验收再分发小红书");
  }
  return ensurePinChannelRow(pinId, CHANNEL_XHS);
}

/** 全自动入队:创建渠道行 + 发布 job 入子队列(worker 调 xhs-gateway)。
 * jobId 确定(每 pin 一个),先查态再投——同 jobId 旧 job 还在保留窗口时
 * BullMQ 会**静默丢弃**新 job;双击「发布」此前靠 Date.now() 拼 id 等于每次
 * 都是新 job,直接产生两篇笔记。在途即幂等返回,终态先 remove 再投。
 * 重试:attempts 3 + 指数退避 30s→60s→120s(gateway 侧有按 pin 的幂等闸,
 * 重试不会再发第二篇);终态 failed 重新发起时复位 pending(UI 立即转「重试中」)。 */
export async function enqueueXhsAutoPublish(pinId: bigint): Promise<{ jobId: string }> {
  const row = await distributePinToXhs(pinId);
  if (row.status === PUBLISH_STATUS_FAILED) {
    await markPinChannelPending(row.id);
  }
  const jobId = `xhs-auto-${pinId.toString()}`;
  const queue = getQueue(QUEUE_DISTRIBUTE_XHS);
  const stale = await queue.getJob(jobId);
  if (stale) {
    const state = await stale.getState();
    if (state === "waiting" || state === "delayed" || state === "active") {
      logInfo("pins.xhs.already_queued", { jobId, pinId: pinId.toString(), state });
      return { jobId };
    }
    await stale.remove();
  }
  await queue.add(
    DISTRIBUTE_JOB_XHS_AUTO,
    { pinId: pinId.toString() },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  logger.info({ event: "pins.xhs.auto_enqueued", jobId, pinId: pinId.toString() });
  return { jobId };
}

/** 登录态录入(抖音同款手动 Cookie 心智,M49 批X3):F12 复制的 cookie 串
 * 转发 xhs-gateway 验证登录并落 storage_state(卷持久化,后续发布免登) */
export async function ingestXhsCookies(cookieHeader: string): Promise<void> {
  const base = douyinGatewayBase();
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

/** 发布物料(标题/轻文字/图片字节 base64)——worker 消费侧组装用 */
export interface PinXhsImage {
  name: string;
  dataB64: string;
}

export interface PinXhsMaterial {
  title: string;
  content: string;
  images: PinXhsImage[];
}

/** 收集贴图发布物料:图片经存储抽象读字节(base64 下发)。
 *
 * 生产 MEDIA_STORAGE=cos 后新图只在桶里(本地卷 M19 后不增新图),容器间
 * 传本地绝对路径在新图场景必不存在(2026-10-27 生产实收:No such file);
 * mediaStorage.get 双后端同源,字节过内网、gateway 保持零密钥。任一图缺失
 * 视为物料不完整直接失败——静默跳过会复刻「只发单图」类缺陷。
 */
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
  const marker = "/wp-content/uploads/";
  const images: PinXhsImage[] = [];
  const missing: string[] = [];
  for (const img of pin.images) {
    const idx = img.mediaPath.indexOf(marker);
    const key = decodeURIComponent(
      idx >= 0 ? img.mediaPath.slice(idx + marker.length) : img.mediaPath.replace(/^\//, ""),
    );
    const buf = await mediaStorage.get(key);
    if (!buf) {
      missing.push(key);
      continue;
    }
    images.push({ name: path.basename(key), dataB64: buf.toString("base64") });
  }
  if (missing.length > 0) {
    throw new Error(`图片不在存储(共 ${missing.length} 张):${missing.join(", ")}`);
  }
  return { title: pin.title, content: pin.content, images };
}

/** 全自动发布(worker 消费):调 xhs-gateway(/xhs/publish)→ 成功落
 * synced+noteUrl;失败上抛——failed 落账由 worker handler 单点承担
 * (此处重复落账会致 attempts 双计数)。 */
export async function autoPublishPinToXhs(pinId: bigint): Promise<void> {
  const row = await prisma.contentPinChannel.findUnique({
    where: { pinId_channel: { pinId, channel: CHANNEL_XHS } },
  });
  if (!row) throw new Error("渠道行不存在(先标记分发)");
  // 已发成功不再进浏览器:重试/重投/人工再点一次都必须在此止步,
  // 否则就是第二篇笔记(gateway 侧另有一道按 pin 的幂等闸兜底)
  if (row.status === PUBLISH_STATUS_SYNCED) {
    logInfo("pins.xhs.skip_already_synced", { pinId: pinId.toString() });
    return;
  }
  {
    const material = await gatherPinXhsMaterial(pinId);
    const base = douyinGatewayBase();
    const res = await fetch(`${base}/xhs/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pinId: pinId.toString(),
        title: material.title,
        content: material.content,
        images: material.images,
      }),
      // 客户端超时只是「我不等了」,服务端协程不会被取消,笔记仍会发出去。
      // gateway 侧发布预算 XHS_PUBLISH_TIMEOUT_SECONDS=180,这里留足余量;
      // 两边等长会稳定制造「客户端先放弃、服务端后成功」的假失败。
      signal: AbortSignal.timeout(300_000),
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
    await markPinChannelSynced(row.id, { publishId: payload.note_url ?? "" });
    logInfo("pins.xhs.auto_published", { pinId: pinId.toString() });
  }
}
