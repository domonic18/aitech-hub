/**
 * 文生图封面编排(M14 批⑥,验收反馈问题6):标题/摘要/标签 → prompt →
 * cover 角色绑定模型生图(多候选)→ 逐张 uploadMedia 入库(sha1 去重 + sharp
 * 缩略管线)→ ai_cover_candidate 落库,编辑器凭 token 轮询选用。
 * 云厂商生图 10-30s,走 QUEUE_COVER_GEN worker,不占请求(请求内禁秒级任务)。
 */
import { randomUUID } from "node:crypto";

import { prisma } from "../db";
import { logger } from "../logger";
import { COVER_JOB_GEN, getQueue, QUEUE_COVER_GEN } from "../queue";
import { AI_PURPOSE_COVER } from "./constants";
import { buildCoverPrompt, COVER_CANDIDATE_COUNT, COVER_IMAGE_SIZE } from "./cover-prompt";
import { decodeImageB64, generateImages, sniffImageMime } from "./image-client";
import { AiAdminError, AiClientError } from "./errors";
import { resolveAiModel } from "./resolver";
import { recordAiUsage } from "./usage-log";
import { uploadMedia } from "../media/service";

export { buildCoverPrompt, COVER_CANDIDATE_COUNT, COVER_IMAGE_SIZE };

export interface CoverGenJobData {
  token: string;
  /** 编辑态文章 id(字符串化 BigInt;创建态 null) */
  postId: string | null;
  title: string;
  excerpt: string;
  tags: string[];
}

/** 入队(路由消费):绑定缺失即抛 disabled(400 明示),不产生无效 job */
export async function enqueueCoverGen(
  data: CoverGenJobData,
): Promise<{ jobId: string; token: string }> {
  const model = await resolveAiModel(AI_PURPOSE_COVER);
  if (!model) {
    throw new AiAdminError(
      "disabled",
      "未绑定或未启用「封面生图(cover)」模型:先到 AI 配置完成任务绑定(需 OpenAI images/generations 兼容端点)",
    );
  }
  const token = data.token || randomUUID();
  const jobId = `cover-gen-${Date.now().toString(36)}`; // jobId 禁冒号(与 audit- 同口径)
  await getQueue(QUEUE_COVER_GEN).add(
    COVER_JOB_GEN,
    { ...data, token },
    {
      jobId,
      attempts: 1, // 生图按张计费,失败不自动重试(用户手动重发)
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
  logger.info({ event: "cover.gen_enqueued", jobId, modelId: model.id, postId: data.postId });
  return { jobId, token };
}

/** worker 消费:生图 → 入媒体库 → 候选落库。失败上抛(BullMQ 记 failedReason,轮询透出) */
export async function coverGenJob(data: CoverGenJobData): Promise<{ generated: number }> {
  const model = await resolveAiModel(AI_PURPOSE_COVER);
  if (!model) throw new AiClientError("unsupported", "cover 角色绑定已缺失");
  const prompt = buildCoverPrompt(data);
  const startedAt = Date.now();
  let images;
  try {
    images = await generateImages({
      protocol: model.protocol,
      baseUrl: model.baseUrl,
      modelId: model.modelId,
      apiKey: model.apiKey,
      prompt,
      n: COVER_CANDIDATE_COUNT,
      size: COVER_IMAGE_SIZE,
      timeoutSec: model.timeoutSec,
    });
  } catch (e) {
    // 请求级失败(整批无图=不计费):落 failed 行供看板观测,错误原样上抛
    await recordAiUsage({
      role: AI_PURPOSE_COVER,
      modelId: model.id,
      modelKey: model.modelId,
      status: "failed",
    });
    throw e;
  }
  // 生图按张计费:逐张落行(status ok/degraded=备用),费用读时 = 行数 × price_per_image
  const durationMs = Date.now() - startedAt;
  for (let i = 0; i < images.length; i++) {
    await recordAiUsage({
      role: AI_PURPOSE_COVER,
      modelId: model.id,
      modelKey: model.modelId,
      durationMs,
      status: model.source === "backup" ? "degraded" : "ok",
    });
  }
  const postId = data.postId ? BigInt(data.postId) : null;
  let generated = 0;
  for (const img of images) {
    try {
      const bytes = decodeImageB64(img.b64);
      const mime = sniffImageMime(bytes);
      const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
      const saved = await uploadMedia({
        data: bytes,
        mime,
        filename: `cover-gen-${data.token.slice(0, 8)}-${generated + 1}.${ext}`,
      });
      await prisma.coverCandidate.create({
        data: {
          token: data.token,
          postId,
          prompt,
          mediaPath: saved.path,
          modelId: model.id,
        },
      });
      generated += 1;
    } catch (e) {
      // 单张失败(解码/白名单/落库)不废整批,计数透出
      logger.warn({
        event: "cover.gen_candidate_failed",
        token: data.token,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  logger.info({ event: "cover.gen_done", token: data.token, generated, promptLen: prompt.length });
  return { generated };
}

/** 轮询读侧(路由消费):候选按 token 全量返回(job 过期被清后仍可取历史候选) */
export async function listCoverCandidates(
  token: string,
): Promise<Array<{ id: string; path: string; prompt: string; createdAt: Date }>> {
  const rows = await prisma.coverCandidate.findMany({
    where: { token },
    orderBy: { id: "desc" },
    take: 12,
    select: { id: true, mediaPath: true, prompt: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id.toString(),
    path: r.mediaPath,
    prompt: r.prompt,
    createdAt: r.createdAt,
  }));
}
