/**
 * 公众号草稿同步·入队侧(M17 批③,requirement §4 多渠道分发):
 * 入队三口(单篇一键/批量多选/发布自动)→ QUEUE_DISTRIBUTE(worker 并发 1,
 * 微信频控串行)。资格前置全 400 人话(未配置/旧文/缺封面/pending 拒重入队);
 * 批量先逐篇预检,合格者单 job 顺序推。worker 执行管线在 ./wechat-sync-run
 * (依赖单向 run→sync,本文件是 job 数据契约与行级工具的唯一出口)。 */
import { randomUUID } from "node:crypto";

import { isP2002, prisma } from "../db";
import { logger } from "../logger";
import {
  getQueue,
  QUEUE_DISTRIBUTE,
  DISTRIBUTE_JOB_WECHAT,
  DISTRIBUTE_JOB_WECHAT_BATCH,
} from "../queue";
import { getWechatRuntimeConfig, type WechatRuntimeConfig } from "./wechat-config-admin";
import { DistributeError } from "./errors";
import {
  CHANNEL_WECHAT,
  DISTRIBUTE_BATCH_MAX,
  PUBLISH_STATUS_FAILED,
  PUBLISH_STATUS_PENDING,
  WECHAT_DIGEST_MAX,
  WECHAT_TITLE_MAX,
} from "./channels";

export interface WechatSyncOverrides {
  title?: string;
  digest?: string;
  coverPath?: string;
}

export interface WechatSyncJobData {
  token: string;
  postId: string;
  overrides?: WechatSyncOverrides;
}

export interface WechatBatchJobData {
  token: string;
  ids: string[];
}

/** 批量入队结果(路由 202 响应体;skipped 携带人话原因) */
export interface WechatBatchEnqueue {
  jobId: string;
  token: string;
  eligible: string[];
  skipped: { id: string; reason: string }[];
}

/** 渠道就绪配置(解密后凭证;未启用/缺凭证 → disabled 指引配置页) */
export async function requireReadyConfig(): Promise<WechatRuntimeConfig & { appSecret: string }> {
  const cfg = await getWechatRuntimeConfig();
  const secret = cfg?.appSecret;
  if (!cfg || !cfg.enabled || !cfg.appid || !secret) {
    throw new DistributeError(
      "disabled",
      "公众号渠道未就绪:先到「内容分发」完成凭证配置、启用渠道并通过测试连接",
    );
  }
  return { ...cfg, appSecret: secret };
}

/** 渠道行取用(缺则建 pending 默认行;唯一约束兜底并发建行) */
export async function ensureChannelRow(postId: bigint) {
  const where = { postId_channel: { postId, channel: CHANNEL_WECHAT } };
  const found = await prisma.publishChannel.findUnique({ where });
  if (found) return found;
  try {
    return await prisma.publishChannel.create({ data: { postId, channel: CHANNEL_WECHAT } });
  } catch (e) {
    if (isP2002(e)) return prisma.publishChannel.findUniqueOrThrow({ where });
    throw e;
  }
}

/** 覆盖值校验(弹窗已拦,入口双保险):title 1-64 字、digest ≤120 字 */
function validateOverrides(overrides?: WechatSyncOverrides): void {
  const t = overrides?.title?.trim();
  if (t !== undefined && (t === "" || [...t].length > WECHAT_TITLE_MAX)) {
    throw new DistributeError("invalid", `标题需 1-${WECHAT_TITLE_MAX} 字`);
  }
  if (overrides?.digest !== undefined && [...overrides.digest.trim()].length > WECHAT_DIGEST_MAX) {
    throw new DistributeError("invalid", `摘要最多 ${WECHAT_DIGEST_MAX} 字`);
  }
}

/** 单篇入队(一键/自动钩子消费):资格前置全 400 人话;行置 pending 幂等拒重 */
export async function enqueueWechatSync(
  postId: bigint,
  overrides?: WechatSyncOverrides,
): Promise<{ jobId: string; token: string }> {
  await requireReadyConfig();
  validateOverrides(overrides);
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { coverPath: true, contentMd: true },
  });
  if (!post) throw new DistributeError("not_found", "文章不存在");
  if (!(post.contentMd ?? "").trim()) {
    throw new DistributeError(
      "invalid",
      "旧文(HTML 保真正文)不支持同步:请先在编辑器转写为 Markdown",
    );
  }
  if (!(overrides?.coverPath ?? post.coverPath)) {
    throw new DistributeError("invalid", "缺少封面:公众号图文必须有封面,请先在编辑器设置封面");
  }
  const row = await ensureChannelRow(postId);
  if (row.status === PUBLISH_STATUS_PENDING) {
    throw new DistributeError("pending", "该文章已在同步队列中,请等待完成后再试");
  }
  const token = randomUUID();
  const jobId = `wechat-${Date.now().toString(36)}`; // BullMQ jobId 禁冒号(与 seo-batch- 同口径)
  await getQueue(QUEUE_DISTRIBUTE).add(
    DISTRIBUTE_JOB_WECHAT,
    { token, postId: postId.toString(), ...(overrides ? { overrides } : {}) },
    { jobId, attempts: 2, removeOnComplete: 50, removeOnFail: 50 },
  );
  await prisma.publishChannel.update({
    where: { id: row.id },
    data: { status: PUBLISH_STATUS_PENDING, lastError: null },
  });
  logger.info({ event: "wechat.sync_enqueued", jobId, postId: postId.toString() });
  return { jobId, token };
}

/** 批量入队(PostsTable 批量条消费):逐篇预检资格,合格者单 job 顺序推 */
export async function enqueueWechatBatch(ids: string[]): Promise<WechatBatchEnqueue> {
  await requireReadyConfig();
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new DistributeError("invalid", "请先勾选要同步的文章");
  if (unique.length > DISTRIBUTE_BATCH_MAX) {
    throw new DistributeError(
      "invalid",
      `单批最多 ${DISTRIBUTE_BATCH_MAX} 篇(当前 ${unique.length})`,
    );
  }
  const rows = await prisma.post.findMany({
    where: { id: { in: unique.map((id) => BigInt(id)) } },
    select: { id: true, coverPath: true, contentMd: true },
  });
  const byId = new Map(rows.map((r) => [r.id.toString(), r]));
  const channelRows = await prisma.publishChannel.findMany({
    where: { channel: CHANNEL_WECHAT, postId: { in: rows.map((r) => r.id) } },
    select: { postId: true, status: true },
  });
  const statusById = new Map(channelRows.map((r) => [r.postId.toString(), r.status]));

  const eligible: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of unique) {
    const post = byId.get(id);
    if (!post) skipped.push({ id, reason: "文章不存在" });
    else if (!(post.contentMd ?? "").trim()) skipped.push({ id, reason: "旧文(HTML 保真)不支持" });
    else if (!post.coverPath) skipped.push({ id, reason: "缺少封面" });
    else if (statusById.get(id) === PUBLISH_STATUS_PENDING)
      skipped.push({ id, reason: "已在同步队列中" });
    else eligible.push(id);
  }
  const token = randomUUID();
  const jobId = `wechat-batch-${Date.now().toString(36)}`;
  if (eligible.length > 0) {
    await getQueue(QUEUE_DISTRIBUTE).add(
      DISTRIBUTE_JOB_WECHAT_BATCH,
      { token, ids: eligible },
      { jobId, attempts: 1, removeOnComplete: 50, removeOnFail: 50 }, // 篇级隔离已内置,整批不重试
    );
    await prisma.publishChannel.updateMany({
      where: { channel: CHANNEL_WECHAT, postId: { in: eligible.map((id) => BigInt(id)) } },
      data: { status: PUBLISH_STATUS_PENDING, lastError: null },
    });
  }
  logger.info({
    event: "wechat.batch_enqueued",
    jobId,
    eligible: eligible.length,
    skipped: skipped.length,
  });
  return { jobId, token, eligible, skipped };
}

/** 发布自动同步(posts-admin#publishPost 收口):渠道关/旧文/缺封面/synced
 * (不自动重推,防覆盖公众号侧人工微调)/pending 静默跳过;异常只 warn 永不抛。 */
export async function maybeEnqueueAutoWechat(postId: bigint): Promise<void> {
  try {
    const cfg = await getWechatRuntimeConfig();
    if (!cfg?.enabled || !cfg.autoSyncEnabled || !cfg.appid || !cfg.appSecret) return;
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { coverPath: true, contentMd: true },
    });
    if (!post || !(post.contentMd ?? "").trim() || !post.coverPath) return;
    const row = await prisma.publishChannel.findUnique({
      where: { postId_channel: { postId, channel: CHANNEL_WECHAT } },
      select: { status: true },
    });
    if (row && row.status !== PUBLISH_STATUS_FAILED) return;
    await enqueueWechatSync(postId);
    logger.info({ event: "wechat.auto_enqueued", postId: postId.toString() });
  } catch (e) {
    logger.warn({
      event: "wechat.auto_enqueue_failed",
      postId: postId.toString(),
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
