/**
 * 视频解读(M9,arch/02 §3.2):interpreter 队列编排——下载无水印流 → ffmpeg 抽音轨 →
 * 云 ASR 转写 → LLM 结构化概括(topic/summary/points)→ telegram.ai_* 列落库。
 * 版权红线:「转写是输入,不是资产」——不设 transcript 列,play_url 仅经 job data
 * 过境(removeOnComplete/Fail 50 压 Redis 痕迹),临时音视频文件判读 try/finally 即删。
 * ASR 终败(重试≤2)→ missing_transcript 降级:仍走 LLM 基于文案元数据概括,不阻塞入流。
 * 两层重试语义:ASR/LLM 解析失败在管道内兜住;下载/网关/LLM 网络层上抛给 BullMQ attempts。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

import { transcribeAudio, type TranscribeInput } from "../ai/asr-client";
import { AI_PURPOSE_INTERPRET } from "../ai/constants";
import { AiClientError } from "../ai/errors";
import { buildInterpretPrompt, parseInterpretResult } from "../ai/interpret-result";
import { chatJson } from "../ai/llm-client";
import { getRoleDailyMax, resolveAiModel, type ResolvedAiModel } from "../ai/resolver";
import { decryptSecret } from "../crypto/secret-box";
import { prisma } from "../db";
import { logger } from "../logger";
import { getQueue, QUEUE_INTERPRETER } from "../queue";

import { douyinAdapter } from "./adapters/video/douyin";
import {
  TELEGRAM_AI_DONE,
  TELEGRAM_AI_FAILED,
  TELEGRAM_AI_MISSING_TRANSCRIPT,
  TELEGRAM_AI_PROCESSING,
} from "./constants";
import { decryptJars } from "./cookies";

/** interpret job data:playUrl 过境字段(job 消费完随保留窗口即焚),禁落库 */
export interface InterpretJobData {
  /** telegram.id(BigInt → string 出口惯例) */
  telegramId: string;
  /** 平台作品 id:存量补解读经网关重拉 listing 的匹配锚 */
  videoId: string | null;
  /** 无水印直链(临时签名 URL);null=入库时未透出,processor 现场重取 */
  playUrl: string | null;
  platform: string;
  /** 博主台账 secUid(直链重拉用);null=博主已删,只能吃过境直链 */
  secUid: string | null;
}

/** 解读就绪 = ASR 渠道已启用 + interpret 角色已绑定可用模型(未配置是运营态,不标条目失败) */
export async function isInterpretReady(): Promise<boolean> {
  const asr = await prisma.asrConfig.findUnique({ where: { id: 1 }, select: { enabled: true } });
  if (!asr?.enabled) return false;
  return (await resolveAiModel(AI_PURPOSE_INTERPRET)) !== null;
}

/** 入队解读(jobId=interpret:{id} 幂等;attempts 兜下载/网关网络层,ASR 重试在管道内) */
export async function enqueueInterpret(data: InterpretJobData): Promise<void> {
  await getQueue(QUEUE_INTERPRETER).add("interpret-video", data, {
    jobId: `interpret:${data.telegramId}`,
    attempts: 3,
    backoff: { type: "fixed", delay: 60_000 },
    removeOnComplete: 50, // 压低 playUrl 在 Redis 的残留条数
    removeOnFail: 50,
  });
}

export interface InterpretOutcome {
  telegramId: string;
  status:
    | "done"
    | "missing_transcript"
    | "failed"
    | "skipped_not_found"
    | "skipped_done"
    | "skipped_not_ready"
    | "deferred_quota";
  transcriptUsed: boolean;
  error?: string;
}

const DOWNLOAD_TIMEOUT_SEC = 60;
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100MB(并发 1,内存缓冲可承受)
const ASR_RETRIES = 2; // 管道内重试(首次 + 2 重试);终败降级不抛
const ASR_RETRY_DELAY_MS = 3_000;
const LLM_PARSE_RETRIES = 1; // 输出不成 JSON 重试一次;网络错误不在此层
const QUOTA_DEFER_MS = 30 * 60_000;
const ASR_TIMEOUT_SEC = 120;

const execFileAsync = promisify(execFile);

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 单自然日已判读条数(服务器本地时区;done + missing_transcript 均占额) */
async function countTodayInterpreted(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return prisma.telegram.count({
    where: {
      aiRanAt: { gte: start },
      aiStatus: { in: [TELEGRAM_AI_DONE, TELEGRAM_AI_MISSING_TRANSCRIPT] },
    },
  });
}

async function markFailed(id: bigint, err: unknown): Promise<void> {
  await prisma.telegram
    .update({
      where: { id },
      data: { aiStatus: TELEGRAM_AI_FAILED, lastAiError: errMessage(err).slice(0, 500) },
    })
    .catch(() => undefined);
}

/** 经网关重拉 listing(maxPages=3)按 videoId 匹配直链(存量补读/过境链过期两路) */
async function fetchFreshPlayUrl(sourceId: number, data: InterpretJobData): Promise<string | null> {
  if (data.platform !== "douyin" || !data.secUid || !data.videoId) return null;
  const platformRow = await prisma.crawlSource.findUnique({
    where: { id: sourceId },
    select: { config: true },
  });
  const jars = decryptJars((platformRow?.config as { cookieJars?: unknown } | null)?.cookieJars);
  if (jars.length === 0) return null;
  const items = await douyinAdapter.fetchRecentVideos({
    secUid: data.secUid,
    cookies: jars,
    maxPages: 3,
  });
  return items.find((it) => it.videoId === data.videoId)?.playUrl ?? null;
}

async function downloadVideoToTmp(playUrl: string, destPath: string): Promise<void> {
  const res = await fetch(playUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_SEC * 1000) });
  if (!res.ok || !res.body) throw new Error(`直链下载失败 HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > DOWNLOAD_MAX_BYTES) {
    throw new Error(`视频超过大小上限(${Math.round(len / 1e6)}MB > 100MB)`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > DOWNLOAD_MAX_BYTES) throw new Error("视频超过大小上限(100MB)");
  await fs.writeFile(destPath, buf);
}

/** ffmpeg 抽 mp3(16k 单声,-t 截断);execFile 数组参数零注入,-loglevel error 防 stderr 撑爆 */
async function extractAudioMp3(
  videoPath: string,
  audioPath: string,
  maxAudioSeconds: number,
): Promise<void> {
  if (!ffmpegPath) throw new Error("ffmpeg 二进制缺失(ffmpeg-static 安装异常)");
  await execFileAsync(ffmpegPath, [
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-t",
    String(maxAudioSeconds),
    "-loglevel",
    "error",
    "-y",
    audioPath,
  ]);
}

/** ASR 管道内重试;终败返回 null(调用方降级 missing_transcript),不抛 */
async function runTranscribeWithRetry(
  input: TranscribeInput,
): Promise<{ text: string | null; error: string | null }> {
  let lastError = "";
  for (let attempt = 0; attempt <= ASR_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, ASR_RETRY_DELAY_MS));
    }
    try {
      return { text: await transcribeAudio(input), error: null };
    } catch (err) {
      lastError = errMessage(err);
      logger.warn({
        event: "interpret.video.asr_retry",
        attempt: attempt + 1,
        error: lastError.slice(0, 200),
      });
    }
  }
  return { text: null, error: lastError };
}

/** LLM 调用 + 解析(输出不成 JSON 就地重试一次);网络/HTTP 错误上抛给 BullMQ attempts */
async function runLlm(model: ResolvedAiModel, system: string, user: string) {
  let lastParseError = "";
  for (let attempt = 0; attempt <= LLM_PARSE_RETRIES; attempt++) {
    const raw = await chatJson({
      protocol: model.protocol,
      baseUrl: model.baseUrl,
      modelId: model.modelId,
      apiKey: model.apiKey,
      system,
      user: attempt === 0 ? user : `${user}\n(再次提醒:只输出一个 JSON 对象,不要任何解释)`,
      timeoutSec: model.timeoutSec,
    });
    const parsed = parseInterpretResult(raw);
    if (parsed.ok) return parsed.data;
    lastParseError = parsed.error;
  }
  throw new AiClientError("business", `LLM 输出无法解析:${lastParseError}`);
}

/** worker「interpret-video」job 入口(管道状态机,分支语义见 InterpretOutcome) */
export async function interpretVideoJob(data: InterpretJobData): Promise<InterpretOutcome> {
  const id = BigInt(data.telegramId);
  const row = await prisma.telegram.findUnique({
    where: { id },
    select: { id: true, title: true, summary: true, aiStatus: true, sourceId: true },
  });
  if (!row)
    return { telegramId: data.telegramId, status: "skipped_not_found", transcriptUsed: false };
  if (row.aiStatus === TELEGRAM_AI_DONE) {
    return { telegramId: data.telegramId, status: "skipped_done", transcriptUsed: false };
  }

  const [asr, model] = await Promise.all([
    prisma.asrConfig.findUnique({ where: { id: 1 } }),
    resolveAiModel(AI_PURPOSE_INTERPRET),
  ]);
  if (!asr?.enabled || model === null) {
    // 未配置是运营态:aiStatus 不动,仅落提示(配置就绪后经 admin 按钮自然重试)
    await prisma.telegram.update({
      where: { id },
      data: { lastAiError: "解读未启用:ASR 渠道或 interpret 模型未配置" },
    });
    return { telegramId: data.telegramId, status: "skipped_not_ready", transcriptUsed: false };
  }

  // 日配额(后台 interpret 绑定可配,缺省 100):满则延迟重投顺延,绝不 throw / 标败
  if ((await countTodayInterpreted()) >= (await getRoleDailyMax(AI_PURPOSE_INTERPRET))) {
    await getQueue(QUEUE_INTERPRETER).add("interpret-video", data, {
      jobId: `interpret:${data.telegramId}:r${Date.now()}`,
      delay: QUOTA_DEFER_MS,
      attempts: 3,
      backoff: { type: "fixed", delay: 60_000 },
      removeOnComplete: 50,
      removeOnFail: 50,
    });
    logger.warn({ event: "interpret.video.quota_deferred", telegramId: data.telegramId });
    return { telegramId: data.telegramId, status: "deferred_quota", transcriptUsed: false };
  }

  await prisma.telegram.update({
    where: { id },
    data: { aiStatus: TELEGRAM_AI_PROCESSING, lastAiError: null },
  });

  // 下载/抽轨/ASR:临时文件 try/finally 即删(版权红线);下载失败上抛给 BullMQ 重试
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "interpret-"));
  let transcript: string | null = null;
  let transcriptError: string | null = null;
  try {
    let playUrl = data.playUrl;
    if (!playUrl) {
      playUrl = await fetchFreshPlayUrl(row.sourceId, data);
      if (!playUrl) {
        await markFailed(id, "无可用播放直链(过境直链缺失且网关重拉未命中)");
        return { telegramId: data.telegramId, status: "failed", transcriptUsed: false };
      }
    }
    const videoPath = path.join(tmpDir, "video.mp4");
    const audioPath = path.join(tmpDir, "audio.mp3");
    try {
      await downloadVideoToTmp(playUrl, videoPath);
    } catch (err) {
      // 过境直链是数小时有效的签名 URL,积压 job 会过期:重拉一次再试
      const fresh = await fetchFreshPlayUrl(row.sourceId, data);
      if (!fresh) throw err;
      await downloadVideoToTmp(fresh, videoPath);
    }
    await extractAudioMp3(videoPath, audioPath, asr.maxAudioSeconds);
    const asrResult = await runTranscribeWithRetry({
      protocol: asr.protocol,
      baseUrl: asr.baseUrl,
      modelId: asr.modelId,
      apiKey: asr.apiKeyEnc ? decryptSecret(asr.apiKeyEnc) : null,
      audio: await fs.readFile(audioPath),
      filename: "audio.mp3",
      hotwords: asr.hotwords,
      timeoutSec: ASR_TIMEOUT_SEC,
    });
    transcript = asrResult.text;
    transcriptError = asrResult.error;
  } catch (err) {
    await markFailed(id, err);
    throw err; // 下载/网关网络层 → BullMQ attempts 兜重试
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  // LLM 概括(ASR 终败降级:仅基于文案元数据,公开信息不触红线)
  const prompt = buildInterpretPrompt({
    title: row.title,
    caption: row.summary,
    topicTags: [],
    transcript,
  });
  let result;
  try {
    result = await runLlm(model, prompt.system, prompt.user);
  } catch (err) {
    await markFailed(id, err);
    // 解析类失败重试无益不烧 attempts;网络/HTTP/超时交给 BullMQ attempts
    if (err instanceof AiClientError && err.kind === "business") {
      return {
        telegramId: data.telegramId,
        status: "failed",
        transcriptUsed: false,
        error: err.message,
      };
    }
    throw err;
  }

  const status = transcript === null ? TELEGRAM_AI_MISSING_TRANSCRIPT : TELEGRAM_AI_DONE;
  await prisma.telegram.update({
    where: { id },
    data: {
      aiStatus: status,
      aiTopic: result.topic,
      aiSummary: result.summary,
      aiPoints: result.points,
      aiRanAt: new Date(),
      lastAiError: transcriptError,
    },
  });
  logger.info({
    event: "interpret.video.done",
    telegramId: data.telegramId,
    status,
    transcriptUsed: transcript !== null,
  });
  return { telegramId: data.telegramId, status, transcriptUsed: transcript !== null };
}
