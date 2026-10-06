/**
 * 公众号草稿同步·执行侧(M17 批⑥自 wechat-sync 拆出,≤350 行红线):
 * worker 消费的同步管线——封面 add_material + 正文图 uploadimg 转存(wechat-media
 * 缓存防重推)→ renderWechatHtml 内联样式 → draft/add(首推)| draft/update(重推,
 * 行 mediaId 锚定)。行状态机 pending → synced/failed;批量 failedIds 隔离、篇间
 * gap 防频控。入队三口(一键/批量/发布自动)在 ./wechat-sync,依赖单向 run→sync。 */
import { postPath } from "../content/post-path";
import { prisma } from "../db";
import { logger } from "../logger";
import { absoluteUrl } from "../seo/site";
import { renderWechatHtml } from "./wechat-html";
import { ensureCoverMedia, transloadContentImages } from "./wechat-media";
import {
  clampDigest,
  PUBLISH_STATUS_FAILED,
  PUBLISH_STATUS_SYNCED,
  WECHAT_CONTENT_MAX_CHARS,
  WECHAT_SYNC_GAP_MS,
  WECHAT_TITLE_MAX,
} from "./channels";
import { WECHAT_THEME_DEFAULT } from "./wechat-themes";
import {
  wechatDraftAdd,
  wechatDraftUpdate,
  type WechatCredentials,
  type WechatDraftArticle,
} from "./wechat-client";
import {
  requireReadyConfig,
  ensureChannelRow,
  type WechatBatchJobData,
  type WechatSyncJobData,
  type WechatSyncOverrides,
} from "./wechat-sync";

export interface WechatSyncResult {
  ok: boolean;
  postId: string;
  mediaId?: string;
  reason?: string;
}

/** 批量进度快照(updateProgress 与 returnvalue 同形;failedIds 失败文章 id 串) */
export interface WechatBatchProgress {
  processed: number;
  total: number;
  failedIds: string[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
    // 主题解析:本次覆盖 > 行快照(上次推送所用,重推沿用)> 渠道默认
    const themeId = overrides?.theme?.trim() || row.theme || cfg.theme || WECHAT_THEME_DEFAULT;

    const creds: WechatCredentials = { appid: cfg.appid, appSecret: cfg.appSecret };
    const cover = await ensureCoverMedia(creds, coverPath);
    const finalMd = await transloadContentImages(creds, contentMd);
    const { html } = renderWechatHtml(finalMd, themeId);
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
        theme: themeId,
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
