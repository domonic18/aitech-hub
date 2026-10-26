/**
 * 小红书分发·半自动闭环(M49 批X2):enqueue(LLM 改写 + 3:4 封面卡入队准备)
 * → ready(物料就绪)→ 人工在创作平台粘贴发布 → 笔记链接回填(synced)。
 * 无官方发布 API(plan M49 调研),发布动作永远人工;渠道特有数据走行 data JSON
 * (批X1 约定):{ draft, coverMediaPath, readyAt, noteUrl? }。
 */
import { Prisma } from "@prisma/client";

import { renderCardPng } from "../card/render";
import { prisma } from "../db";
import { logger } from "../logger";
import { mediaStorage, relToUploadsUrl } from "../media/storage";
import { AI_PURPOSE_WRITING } from "../ai/constants";
import { resolveAiModel } from "../ai/resolver";
import { getQueue, QUEUE_DISTRIBUTE_XHS, DISTRIBUTE_JOB_XHS_PREPARE } from "../queue";
import { DistributeError } from "./errors";
import { ensureChannelRowUnique } from "./channel-row";
import {
  CHANNEL_XHS,
  PUBLISH_STATUS_FAILED,
  PUBLISH_STATUS_PENDING,
  PUBLISH_STATUS_READY,
  PUBLISH_STATUS_SYNCED,
} from "./channels";
import { rewriteForXhs, type XhsDraft } from "./xhs-rewrite";

export interface XhsRowData {
  draft: XhsDraft;
  coverMediaPath: string;
  readyAt: string;
  noteUrl?: string;
}

const MD_IMG_RE = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;

function escHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** 3:4 封面卡 HTML(1080×1440 定尺寸;card-renderer 渲 PNG) */
function coverHtml(title: string): string {
  const t = escHtml(title);
  return (
    `<div style="width:1080px;height:1440px;box-sizing:border-box;display:flex;flex-direction:column;` +
    `justify-content:space-between;padding:96px;background:linear-gradient(160deg,#1e1b4b 0%,#312e81 55%,#4c1d95 100%);` +
    `font-family:'PingFang SC','Microsoft YaHei',system-ui,sans-serif;">` +
    `<div style="font-size:40px;letter-spacing:4px;color:#c7d2fe;">一起AI · 小红书笔记</div>` +
    `<div style="font-size:92px;font-weight:700;line-height:1.3;color:#ffffff;">${t}</div>` +
    `<div style="font-size:38px;color:#a5b4fc;">17aitech.com · AI 工程实战</div>` +
    `</div>`
  );
}

/** 入队物料准备(资格前置全 400 人话;pending 拒重,ready/synced 允许重新生成) */
export async function enqueueXhsPrepare(postId: bigint): Promise<{ jobId: string }> {
  // 模型绑定人话早失败(resolver 抛错形态不定,统一包成 DistributeError)
  try {
    const model = await resolveAiModel(AI_PURPOSE_WRITING);
    if (model === null) throw new Error("未绑定");
  } catch {
    throw new DistributeError(
      "disabled",
      "先到 AI 配置·任务绑定 绑定「文章撰写」模型,再生成小红书笔记",
    );
  }
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { contentMd: true },
  });
  if (!post) throw new DistributeError("not_found", "文章不存在");
  if (!post.contentMd?.trim()) {
    throw new DistributeError("invalid", "旧文(HTML 保真正文)不支持改写:先转写 Markdown");
  }
  const row = await ensureChannelRowUnique(
    () =>
      prisma.publishChannel.findUnique({
        where: { postId_channel: { postId, channel: CHANNEL_XHS } },
      }),
    () => prisma.publishChannel.create({ data: { postId, channel: CHANNEL_XHS } }),
  );
  if (row.status === PUBLISH_STATUS_PENDING) {
    throw new DistributeError("pending", "小红书物料生成中,请等待完成后再试");
  }
  const jobId = `xhs-${postId.toString()}-${Date.now().toString(36)}`; // BullMQ jobId 禁冒号
  await getQueue(QUEUE_DISTRIBUTE_XHS).add(
    DISTRIBUTE_JOB_XHS_PREPARE,
    { postId: postId.toString() },
    { jobId, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
  );
  await prisma.publishChannel.update({
    where: { id: row.id },
    data: { status: PUBLISH_STATUS_PENDING, lastError: null },
  });
  logger.info({ event: "xhs.enqueued", jobId, postId: postId.toString() });
  return { jobId };
}

/** 物料准备(worker 消费):LLM 改写 → 3:4 封面卡 → data 落库 → ready */
export async function xhsPrepareJob(postId: bigint): Promise<void> {
  const row = await prisma.publishChannel.findFirst({
    where: { postId, channel: CHANNEL_XHS },
    orderBy: { id: "desc" },
  });
  if (!row) throw new Error("小红书渠道行不存在");
  try {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { title: true, contentMd: true },
    });
    if (!post?.contentMd?.trim()) throw new Error("无 Markdown 正文");
    const model = await resolveAiModel(AI_PURPOSE_WRITING);
    if (model === null) throw new Error("「文章撰写」模型未绑定");
    const draft = await rewriteForXhs(model, post.title, post.contentMd);
    const rendered = await renderCardPng(coverHtml(draft.title), {
      width: 1080,
      maxHeight: 1440,
    });
    const coverMediaPath = `xhs/${postId.toString()}/cover.png`;
    await mediaStorage.put(coverMediaPath, rendered.png);
    const prev = (row.data ?? {}) as Partial<XhsRowData>;
    await prisma.publishChannel.update({
      where: { id: row.id },
      data: {
        status: PUBLISH_STATUS_READY,
        title: draft.title,
        lastError: null,
        attempts: { increment: 1 },
        data: {
          ...prev,
          draft,
          coverMediaPath,
          readyAt: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    logger.info({ event: "xhs.ready", postId: postId.toString() });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.publishChannel
      .update({
        where: { id: row.id },
        data: { status: PUBLISH_STATUS_FAILED, lastError: msg, attempts: { increment: 1 } },
      })
      .catch(() => undefined);
    throw e;
  }
}

/** 笔记链接回填(人工发布确认):ready/synced → synced */
export async function publishXhsNote(postId: bigint, noteUrl: string): Promise<void> {
  let host = "";
  try {
    host = new URL(noteUrl).hostname;
  } catch {
    throw new DistributeError("invalid", "笔记链接格式无效");
  }
  if (!host.endsWith("xiaohongshu.com")) {
    throw new DistributeError("invalid", "仅接受 xiaohongshu.com 域名的笔记链接");
  }
  const row = await prisma.publishChannel.findFirst({
    where: { postId, channel: CHANNEL_XHS },
    orderBy: { id: "desc" },
  });
  if (!row) throw new DistributeError("not_found", "小红书渠道行不存在(先生成物料)");
  if (row.status !== PUBLISH_STATUS_READY && row.status !== PUBLISH_STATUS_SYNCED) {
    throw new DistributeError("invalid", "物料尚未就绪,不能标记已发布");
  }
  const prev = (row.data ?? {}) as Partial<XhsRowData>;
  await prisma.publishChannel.update({
    where: { id: row.id },
    data: {
      status: PUBLISH_STATUS_SYNCED,
      syncedAt: new Date(),
      lastError: null,
      data: {
        ...prev,
        draft: prev.draft!,
        coverMediaPath: prev.coverMediaPath!,
        readyAt: prev.readyAt ?? "",
        noteUrl,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  logger.info({ event: "xhs.synced", postId: postId.toString(), noteUrl });
}

/** 物料视图(编辑弹窗消费):行态 + 草稿 + 封面 URL + 正文图清单 */
export async function getXhsMaterial(postId: bigint): Promise<{
  status: string | null;
  material: XhsRowData | null;
  lastError: string | null;
  postTitle: string;
  coverUrl: string | null;
  images: Array<{ path: string; url: string }>;
} | null> {
  const row = await prisma.publishChannel.findFirst({
    where: { postId, channel: CHANNEL_XHS },
    orderBy: { id: "desc" },
  });
  if (!row) return null;
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { title: true, contentMd: true },
  });
  const images: Array<{ path: string; url: string }> = [];
  const seen = new Set<string>();
  for (const m of (post?.contentMd ?? "").matchAll(MD_IMG_RE)) {
    const p = m[1] ?? "";
    if (p === "" || seen.has(p)) continue;
    seen.add(p);
    images.push({ path: p, url: relToUploadsUrl(p) ?? p });
  }
  const material = (row.data ?? null) as XhsRowData | null;
  return {
    status: row.status,
    material,
    lastError: row.lastError,
    postTitle: post?.title ?? "",
    coverUrl: material?.coverMediaPath
      ? (relToUploadsUrl(material.coverMediaPath) ?? material.coverMediaPath)
      : null,
    images,
  };
}
