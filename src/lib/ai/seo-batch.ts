/**
 * 批量 SEO 补全编排(M16 问题8,仅补空缺):文章管理多选 → 入队单批次 job
 * (QUEUE_SEO_BATCH,worker 并发 1 顺序逐篇),逐篇「两字段均非空跳过」→
 * suggestSeo(复用 summarize 绑定,role="seo" 台账逐篇落行)→ 仅写空字段
 * (已有值哪怕单侧也不覆盖);单篇失败隔离记 failedIds 继续不废整批。
 * LLM 秒级 × ≤50 篇走 worker 不占请求(请求内禁秒级任务);前端凭 token
 * 轮询 GET /api/posts/seo-suggest-batch/[jobId] 取进度。
 */
import { randomUUID } from "node:crypto";

import { prisma } from "../db";
import { logger } from "../logger";
import { getQueue, QUEUE_SEO_BATCH, SEO_JOB_BATCH } from "../queue";
import { AI_PURPOSE_SUMMARIZE } from "./constants";
import { AiAdminError } from "./errors";
import { resolveAiModel } from "./resolver";
import { suggestSeo } from "./seo-suggest";

export interface SeoBatchJobData {
  token: string;
  ids: string[];
}

/** 进度快照(updateProgress 与 returnvalue 同形;failedIds 为失败文章 id 串) */
export interface SeoBatchProgress {
  processed: number;
  total: number;
  skipped: number;
  failedIds: string[];
}

/** 入队(路由消费):绑定缺失即抛 disabled(400 明示),不产生无效 job */
export async function enqueueSeoBatch(
  data: SeoBatchJobData,
): Promise<{ jobId: string; token: string }> {
  const model = await resolveAiModel(AI_PURPOSE_SUMMARIZE);
  if (!model) {
    throw new AiAdminError(
      "disabled",
      "未绑定或未启用「摘要(summarize)」模型:先到 AI 配置完成任务绑定",
    );
  }
  const token = data.token || randomUUID();
  const jobId = `seo-batch-${Date.now().toString(36)}`; // jobId 禁冒号(与 cover-gen- 同口径)
  await getQueue(QUEUE_SEO_BATCH).add(
    SEO_JOB_BATCH,
    { ...data, token },
    { jobId, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
  );
  logger.info({ event: "seo.batch_enqueued", jobId, total: data.ids.length, modelId: model.id });
  return { jobId, token };
}

/** worker 消费:逐篇仅补空缺;单篇失败隔离(记 failedIds 继续),永不因单篇废整批 */
export async function seoBatchJob(
  data: SeoBatchJobData,
  onProgress?: (p: SeoBatchProgress) => Promise<void>,
): Promise<SeoBatchProgress> {
  const model = await resolveAiModel(AI_PURPOSE_SUMMARIZE);
  if (!model) throw new AiAdminError("disabled", "「摘要(summarize)」模型绑定已缺失");
  const progress: SeoBatchProgress = {
    processed: 0,
    total: data.ids.length,
    skipped: 0,
    failedIds: [],
  };
  for (const id of data.ids) {
    let postId: bigint;
    try {
      postId = BigInt(id);
    } catch {
      progress.failedIds.push(id);
      progress.processed += 1;
      continue;
    }
    try {
      const row = await prisma.post.findUnique({
        where: { id: postId },
        select: {
          title: true,
          contentMd: true,
          excerpt: true,
          category: { select: { slug: true } },
          seoTitle: true,
          seoDescription: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
      });
      if (!row) {
        progress.failedIds.push(id);
      } else if ((row.seoTitle ?? "").trim() !== "" && (row.seoDescription ?? "").trim() !== "") {
        progress.skipped += 1; // 仅补空缺语义:两字段均非空跳过(不覆盖既有值)
      } else {
        const r = await suggestSeo({
          title: row.title,
          contentMd: row.contentMd ?? "",
          excerpt: row.excerpt ?? "",
          tags: row.tags.map((t) => t.tag.name),
          categorySlug: row.category.slug,
        });
        await prisma.post.update({
          where: { id: postId },
          data: {
            ...((row.seoTitle ?? "").trim() !== "" ? {} : { seoTitle: r.seoTitle }),
            ...((row.seoDescription ?? "").trim() !== ""
              ? {}
              : { seoDescription: r.seoDescription }),
          },
        });
      }
    } catch (e) {
      progress.failedIds.push(id);
      logger.warn({
        event: "seo.batch_post_failed",
        postId: id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    progress.processed += 1;
    if (onProgress) await onProgress({ ...progress, failedIds: [...progress.failedIds] });
  }
  logger.info({
    event: "seo.batch_done",
    token: data.token,
    total: progress.total,
    skipped: progress.skipped,
    failed: progress.failedIds.length,
  });
  return progress;
}
