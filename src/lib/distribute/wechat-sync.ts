/**
 * 公众号草稿同步编排(M17 批③,requirement §4 多渠道分发):
 * 入队三口(单篇一键/批量多选/发布自动)→ QUEUE_DISTRIBUTE(worker 并发 1,微信频控串行)
 * → syncOnePost:封面 add_material + 正文图 uploadimg 转存(wechat-media.ts 缓存防重推)
 * → renderWechatHtml 内联样式 → draft/add(首推)| draft/update(重推,行 mediaId 锚定)。
 * 行状态机:pending(在队)→ synced/failed;pending 拒重入队;批量 failedIds 隔离。 */
import { randomUUID } from "node:crypto";

import { postPath } from "../content/post-path";
import { isP2002, prisma } from "../db";
import { logger } from "../logger";
import {
  getQueue,
  QUEUE_DISTRIBUTE,
  DISTRIBUTE_JOB_WECHAT,
  DISTRIBUTE_JOB_WECHAT_BATCH,
} from "../queue";
import { absoluteUrl } from "../seo/site";
import { renderWechatHtml } from "./wechat-html";
import { ensureCoverMedia, transloadContentImages } from "./wechat-media";
import { getWechatRuntimeConfig, type WechatRuntimeConfig } from "./wechat-config-admin";
import { DistributeError } from "./errors";
import {
  CHANNEL_WECHAT,
  clampDigest,
  DISTRIBUTE_BATCH_MAX,
  PUBLISH_STATUS_FAILED,
  PUBLISH_STATUS_PENDING,
  PUBLISH_STATUS_SYNCED,
  WECHAT_CONTENT_MAX_CHARS,
  WECHAT_DIGEST_MAX,
  WECHAT_SYNC_GAP_MS,
  WECHAT_TITLE_MAX,
} from "./channels";
import {
  wechatDraftAdd,
  wechatDraftUpdate,
  type WechatCredentials,
  type WechatDraftArticle,
} from "./wechat-client";

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

/** 批量进度快照(updateProgress 与 returnvalue 同形;failedIds 失败文章 id 串) */
export interface WechatBatchProgress {
  processed: number;
  total: number;
  failedIds: string[];
}

/** 批量入队结果(路由 202 响应体;skipped 携带人话原因) */
export interface WechatBatchEnqueue {
  jobId: string;
  token: string;
  eligible: string[];
  skipped: { id: string; reason: string }[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 渠道就绪配置(解密后凭证;未启用/缺凭证 → disabled 指引配置页) */
async function requireReadyConfig(): Promise<WechatRuntimeConfig & { appSecret: string }> {
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
async function ensureChannelRow(postId: bigint) {
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

export interface WechatSyncResult {
  ok: boolean;
  postId: string;
  mediaId?: string;
  reason?: string;
}

/** 失败落行(人话进 lastError;返回不抛,批量隔离靠它) */
async function failSync(rowId: bigint, postId: string, reason: string): Promise<WechatSyncResult> {
  await prisma.publishChannel.update({
    where: { id: rowId },
    data: {
      status: PUBLISH_STATUS_FAILED,
      lastError: reason.slice(0, 500),
      attempts: { increment: 1 },
    },
  });
  logger.warn({ event: "wechat.sync_failed", postId, error: reason });
  return { ok: false, postId, reason };
}

/** 单篇同步全管线(worker 消费):失败落行返回 false,正常成功落 synced */
export async function syncOnePost(
  postId: bigint,
  overrides?: WechatSyncOverrides,
): Promise<WechatSyncResult> {
  const id = postId.toString();
  const cfg = await requireReadyConfig(); // 抛 DistributeError → catch 落 failed
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      slug: true,
      title: true,
      seoTitle: true,
      excerpt: true,
      seoDescription: true,
      coverPath: true,
      contentMd: true,
    },
  });
  if (!post) return { ok: false, postId: id, reason: "文章不存在" };
  const row = await ensureChannelRow(postId);
  try {
    const contentMd = post.contentMd ?? "";
    if (!contentMd.trim()) {
      return await failSync(row.id, id, "旧文(HTML 保真正文)不支持同步:请先转写为 Markdown");
    }
    // 组装微调:本次覆盖 > 渠道行快照(上次推送值,按渠道微调持久) > 文章当前字段
    const title = (overrides?.title?.trim() || row.title || post.seoTitle || post.title).trim();
    if ([...title].length > WECHAT_TITLE_MAX) {
      return await failSync(row.id, id, `标题 ${[...title].length} 字超过上限 ${WECHAT_TITLE_MAX}`);
    }
    const digest = clampDigest(
      (
        overrides?.digest?.trim() ||
        row.digest ||
        post.excerpt ||
        post.seoDescription ||
        title
      ).trim(),
    );
    const coverPath = overrides?.coverPath?.trim() || row.thumbPath || post.coverPath;
    if (!coverPath) return await failSync(row.id, id, "缺少封面:公众号图文必须有封面");

    const creds: WechatCredentials = { appid: cfg.appid, appSecret: cfg.appSecret };
    const cover = await ensureCoverMedia(creds, coverPath);
    const finalMd = await transloadContentImages(creds, contentMd);
    const { html } = renderWechatHtml(finalMd);
    const contentChars = [...html].length;
    if (contentChars > WECHAT_CONTENT_MAX_CHARS) {
      return await failSync(
        row.id,
        id,
        `正文 HTML ${contentChars} 码点超过微信预算 ${WECHAT_CONTENT_MAX_CHARS},请精简正文`,
      );
    }

    const article: WechatDraftArticle = {
      title,
      author: cfg.author,
      digest,
      content: html,
      content_source_url: absoluteUrl(postPath(post.id, post.slug)),
      thumb_media_id: cover.mediaId,
      need_open_comment: 0,
      only_fans_can_comment: 0,
    };
    let mediaId = row.mediaId;
    if (mediaId) await wechatDraftUpdate(creds, mediaId, article);
    else mediaId = await wechatDraftAdd(creds, article);

    await prisma.publishChannel.update({
      where: { id: row.id },
      data: {
        status: PUBLISH_STATUS_SYNCED,
        mediaId,
        title,
        digest,
        thumbPath: coverPath,
        syncedAt: new Date(),
        lastError: null,
        attempts: { increment: 1 },
      },
    });
    logger.info({ event: "wechat.synced", postId: id, mediaId, updated: Boolean(row.mediaId) });
    return { ok: true, postId: id, mediaId };
  } catch (e) {
    return failSync(row.id, id, (e instanceof Error ? e.message : String(e)).slice(0, 500));
  }
}

/** worker 消费(单篇):结果已落行;失败上抛给 BullMQ(attempts 2 兜底瞬态抖动) */
export async function wechatSyncJob(data: WechatSyncJobData): Promise<WechatSyncResult> {
  const r = await syncOnePost(BigInt(data.postId), data.overrides);
  if (!r.ok) throw new Error(r.reason ?? "同步失败");
  return r;
}

/** worker 消费(批量):单 job 顺序逐篇,篇间 gap 防频控;失败隔离记 failedIds */
export async function wechatBatchJob(
  data: WechatBatchJobData,
  onProgress?: (p: WechatBatchProgress) => Promise<void>,
): Promise<WechatBatchProgress> {
  const progress: WechatBatchProgress = { processed: 0, total: data.ids.length, failedIds: [] };
  for (const [i, id] of data.ids.entries()) {
    let postId: bigint;
    try {
      postId = BigInt(id);
    } catch {
      progress.failedIds.push(id);
      progress.processed += 1;
      continue;
    }
    if (!(await syncOnePost(postId)).ok) progress.failedIds.push(id);
    progress.processed += 1;
    if (onProgress) await onProgress({ ...progress, failedIds: [...progress.failedIds] });
    if (i < data.ids.length - 1) await sleep(WECHAT_SYNC_GAP_MS);
  }
  logger.info({
    event: "wechat.batch_done",
    token: data.token,
    total: progress.total,
    failed: progress.failedIds.length,
  });
  return progress;
}
