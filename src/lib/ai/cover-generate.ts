/**
 * 文生图封面编排(M14 批⑥,验收反馈问题6):标题/摘要/标签 → prompt →
 * cover 角色绑定模型生图(多候选)→ 逐张 uploadMedia 入库(sha1 去重 + sharp
 * 缩略管线)→ ai_cover_candidate 落库,编辑器凭 token 轮询选用。
 * 云厂商生图 10-30s,走 QUEUE_COVER_GEN worker,不占请求(请求内禁秒级任务)。
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { prisma } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { COVER_JOB_GEN, getQueue, QUEUE_COVER_GEN } from "../queue";
import { parsePostId } from "../content/posts-admin";
import { AI_PURPOSE_COVER } from "./constants";
import { buildCoverPrompt, COVER_CANDIDATE_COUNT, COVER_IMAGE_SIZE } from "./cover-prompt";
import { suggestCoverPrompt } from "./cover-prompt-suggest";
import { decodeImageB64, downloadImage, generateImages, sniffImageMime } from "./image-client";
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
  /** 正文 markdown(取样后供 agent 提示词步骤;创建态来自编辑器快照,可空) */
  contentMd: string;
  /** 生图 prompt(M16 问题2:前端 AI 建议/手填;空串走 agent 概要提取,再兜底模板) */
  prompt: string;
  /**
   * hold 模式(M31 验收反馈:agent 封面候选):只落临时盘不进媒体库,
   * 候选经预览接口 + HITL 卡交管理员确认,adopt 时才 uploadMedia。
   */
  hold?: boolean;
}

/** hold 候选虚拟路径前缀(candidate.mediaPath 以此开头 = 未入库临时件) */
export const COVER_TEMP_PREFIX = "/.cover-gen-tmp/";

function coverTempAbs(virtualPath: string): string {
  // 虚拟路径形如 /.cover-gen-tmp/<token>/<file>;盘上 = $MEDIA_DIR 同构相对
  return path.resolve(env.MEDIA_DIR, virtualPath.slice(1));
}

/** hold 候选落盘(worker 消费):写 $MEDIA_DIR/.cover-gen-tmp/<token>/,返回虚拟路径 */
async function writeHoldCandidate(
  token: string,
  index: number,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
  const name = `candidate-${index + 1}.${ext}`;
  const dir = coverTempAbs(`${COVER_TEMP_PREFIX}${token}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  return `${COVER_TEMP_PREFIX}${token}/${name}`;
}

/** 读 hold 候选字节(preview 路由 / adopt 消费;越界路径防御性拒读) */
export async function readHoldCandidate(virtualPath: string): Promise<Uint8Array | null> {
  if (!virtualPath.startsWith(COVER_TEMP_PREFIX)) return null;
  const abs = path.resolve(coverTempAbs(virtualPath));
  if (!abs.startsWith(path.resolve(env.MEDIA_DIR, COVER_TEMP_PREFIX.slice(1)))) return null;
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}

/** 清空一批 hold 候选(整批放弃/入库完成后调用;目录不存在静默) */
export async function deleteCoverTemp(token: string): Promise<void> {
  await rm(coverTempAbs(`${COVER_TEMP_PREFIX}${token}`), { recursive: true, force: true });
}

/** hold 候选保留期:交互流(生成→确认)分钟级完成,24h 已足够宽 */
export const COVER_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 定时清扫 hold 候选孤儿目录(技术债批①):悬空中断/被顶替的 run 无人
 * adopt/discard,临时盘只增不减;逐 token 目录按 mtime 判陈旧,超龄整目录
 * 删除。清扫后迟到的 adopt 报「候选临时文件已失效,请重新生成」(人话已有)。
 * 临时根不存在 = 从无临时件,静默零清扫;单目录失败计 failed 不废整轮。
 */
export async function sweepStaleCoverTemp(
  maxAgeMs = COVER_TEMP_MAX_AGE_MS,
): Promise<{ removed: number; failed: number }> {
  const root = path.resolve(env.MEDIA_DIR, COVER_TEMP_PREFIX.slice(1));
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { removed: 0, failed: 0 };
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(root, entry.name);
    try {
      const st = await stat(abs);
      if (st.mtimeMs > cutoff) continue;
      await rm(abs, { recursive: true, force: true });
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  if (removed > 0 || failed > 0) {
    logger.info({ event: "cover.temp_swept", removed, failed, maxAgeMs });
  }
  return { removed, failed };
}

/**
 * 入库确认(工具体 adopt 分支消费):临时件读出 → uploadMedia 入媒体库 →
 * 候选行 mediaPath 切正式路径 → 清临时文件。已入库行幂等返回现路径。
 */
export async function adoptCoverCandidate(candidateId: string): Promise<string> {
  const row = await prisma.coverCandidate.findUnique({
    where: { id: BigInt(candidateId) },
    select: { mediaPath: true, token: true },
  });
  if (!row) throw new Error("候选不存在或已清理");
  if (!row.mediaPath.startsWith(COVER_TEMP_PREFIX)) return row.mediaPath;
  const bytes = await readHoldCandidate(row.mediaPath);
  if (bytes === null) throw new Error("候选临时文件已失效,请重新生成");
  const mime = sniffImageMime(bytes) ?? "image/webp";
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
  const saved = await uploadMedia({
    data: bytes,
    mime,
    filename: `cover-adopt-${row.token.slice(0, 8)}-${candidateId}.${ext}`,
  });
  await prisma.coverCandidate.update({
    where: { id: BigInt(candidateId) },
    data: { mediaPath: saved.path },
  });
  await deleteCoverTemp(row.token);
  logger.info({ event: "cover.candidate_adopted", candidateId, path: saved.path });
  return saved.path;
}

/**
 * 编辑态上下文真相源切换(M31 验收反馈):客户端只传 postId,服务端直读库内
 * 标题/摘要/全部标签/正文——主题稿等标签数超编辑器 5 枚上限的文章照常生成,
 * 且 agent 提示词步骤吃到全文(客户端快照可能过期)。软删/不存在 → null。
 */
export async function loadCoverPostContext(
  postId: string,
): Promise<{ title: string; excerpt: string; tags: string[]; contentMd: string } | null> {
  const id = parsePostId(postId);
  if (id === null) return null;
  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      title: true,
      excerpt: true,
      contentMd: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
  });
  if (!post) return null;
  return {
    title: post.title,
    excerpt: post.excerpt ?? "",
    tags: post.tags.map(({ tag }) => tag.name),
    contentMd: post.contentMd ?? "",
  };
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

/**
 * agent 提示词步骤(M31 验收反馈:空 prompt 不再走死模板):LLM 依标题/摘要/
 * 全部标签/正文取样概要提取画面提示词;失败(未绑定/LLM 异常)回退模板兜底,
 * 不废生图 job。
 */
async function agentCoverPrompt(data: CoverGenJobData): Promise<string> {
  try {
    const r = await suggestCoverPrompt({
      title: data.title,
      excerpt: data.excerpt,
      tags: data.tags,
      contentMd: data.contentMd ?? "",
    });
    return r.prompt;
  } catch (e) {
    logger.warn({
      event: "cover.gen_prompt_agent_fallback",
      postId: data.postId,
      error: e instanceof Error ? e.message : String(e),
    });
    return buildCoverPrompt(data);
  }
}

/** worker 消费:生图 → 入媒体库 → 候选落库。失败上抛(BullMQ 记 failedReason,轮询透出) */
export async function coverGenJob(data: CoverGenJobData): Promise<{ generated: number }> {
  const model = await resolveAiModel(AI_PURPOSE_COVER);
  if (!model) throw new AiClientError("unsupported", "cover 角色绑定已缺失");
  const prompt = data.prompt.trim() !== "" ? data.prompt.trim() : await agentCoverPrompt(data); // agent 概要提取(M31),失败落模板
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
      extraParams: model.extraParams,
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
      // b64 直解;url 形态服务端转存(智谱 CogView 等只回 url,M16 问题1)
      const bytes =
        "b64" in img ? decodeImageB64(img.b64) : await downloadImage(img.url, model.timeoutSec);
      const mime = sniffImageMime(bytes) ?? "image/webp";
      // hold 模式(M31):临时盘 + 虚拟路径,不进媒体库;确认入库走 adoptCoverCandidate
      const mediaPath = data.hold
        ? await writeHoldCandidate(data.token, generated, bytes, mime)
        : (
            await uploadMedia({
              data: bytes,
              mime,
              filename: `cover-gen-${data.token.slice(0, 8)}-${generated + 1}.${
                mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp"
              }`,
            })
          ).path;
      await prisma.coverCandidate.create({
        data: {
          token: data.token,
          postId,
          prompt,
          mediaPath,
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
