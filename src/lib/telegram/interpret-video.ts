/**
 * 视频解读(M9,arch/02 §3.2;M12 批③ 默认化):interpreter 队列编排——下载无水印
 * 流 → ffmpeg 抽音轨 → 云 ASR 转写 → LLM 结构化概括(topic/summary/points)→
 * telegram.ai_* 列落库。M12 起就绪条件解耦 ASR:仅 interpret 绑定即开动,ASR 未
 * 启用/直链不可得时降级「基于文案」概括(buildInterpretPrompt 既有分支),配 ASR
 * 即增强。版权红线:「转写是输入,不是资产」——不设 transcript 列,play_url 仅经
 * job data 过境(removeOnComplete/Fail 50 压 Redis 痕迹),临时音视频文件判读
 * try/finally 即删。ASR 终败(重试≤2)→ missing_transcript 降级,不阻塞入流。
 * 两层重试语义:ASR/LLM 解析失败在管道内兜住;下载/网关/LLM 网络层上抛给 BullMQ attempts。
 */
import { getAsrRuntimeConfig } from "../ai/asr-admin";
import { transcribeAudio, type TranscribeInput } from "../ai/asr-client";
import { chatJsonTask } from "../ai/chat-json-task";
import { AI_ERR_DETAIL_MAX, AI_PURPOSE_INTERPRET } from "../ai/constants";
import { AiClientError } from "../ai/errors";
import { buildInterpretPrompt, parseInterpretResult } from "../ai/interpret-result";
import { getRoleDailyMax, resolveAiModel, type ResolvedAiModel } from "../ai/resolver";
import { AI_USAGE_ROLE_ASR, recordAiUsage } from "../ai/usage-log";
import { prisma } from "../db";
import { logger } from "../logger";
import {
  downloadVideoToTmp,
  extractAudioMp3,
  makeInterpretTmpDir,
  readAudioFile,
  removeTmpDir,
  tmpMediaPaths,
} from "../media/interpret-media";
import { getQueue, QUEUE_INTERPRETER } from "../queue";

import { douyinAdapter } from "./adapters/video/douyin";
import { aiJobOpts, errMessage, markAiFailed, markAiPendingAndEnqueue } from "./ai-shared";
import {
  SOCIAL_BACKFILL_MAX_PAGES,
  TELEGRAM_AI_DONE,
  TELEGRAM_AI_MISSING_TRANSCRIPT,
  TELEGRAM_AI_PENDING,
  TELEGRAM_AI_PROCESSING,
  TELEGRAM_MEDIA_VIDEO,
  VIDEO_PLATFORM_DOUYIN,
} from "./constants";
import { jarsFromConfig } from "./cookies";
import { countTodayAiDone } from "./spider-queries";

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

/** 解读就绪 = interpret 角色已绑定可用模型(M12 起不再前置 ASR:未配 ASR 走文案
 * 概括降级;未绑定模型是运营态,不标条目失败,补扫 tick 绑定后自然消化) */
export async function isInterpretReady(): Promise<boolean> {
  return (await resolveAiModel(AI_PURPOSE_INTERPRET)) !== null;
}

/** interpreter 队列 job name(入队与 worker 消费同源;改名需与 worker/index.ts 同批) */
export const INTERPRET_JOB_NAME = "interpret-video";

/** 解读 jobId(幂等锚,telegram-admin 移除遗留 job 同引此函数)。
 * 分隔符必须用连字符:BullMQ 拒绝含冒号的 custom jobId("Custom Id cannot contain :") */
export function interpretJobId(telegramId: string, suffix?: string): string {
  return `interpret-${telegramId}${suffix ? `-${suffix}` : ""}`;
}

/** 入队解读(attempts 兜网络层,ASR/LLM 解析重试在管道内) */
export async function enqueueInterpret(data: InterpretJobData): Promise<void> {
  await getQueue(QUEUE_INTERPRETER).add(
    INTERPRET_JOB_NAME,
    data,
    aiJobOpts({ jobId: interpretJobId(data.telegramId) }),
  );
}

/** 「先标 pending → 入队,失败回滚 null」视频侧封装(核心 markAiPendingAndEnqueue
 * 在 ai-shared,与 summarize 共用;手动触发与采集钩子单一入口) */
export async function markPendingAndEnqueue(
  telegramId: bigint,
  data: Omit<InterpretJobData, "telegramId">,
): Promise<void> {
  await markAiPendingAndEnqueue(telegramId, () =>
    enqueueInterpret({ telegramId: telegramId.toString(), ...data }),
  );
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

const ASR_RETRIES = 2; // 管道内重试(首次 + 2 重试);终败降级不抛
const ASR_RETRY_DELAY_MS = 3_000;
const QUOTA_DEFER_MS = 30 * 60_000;
const ASR_TIMEOUT_SEC = 120;

/** 经网关重拉 listing(maxPages=3)按 videoId 匹配直链(存量补读/过境链过期两路) */
async function fetchFreshPlayUrl(sourceId: number, data: InterpretJobData): Promise<string | null> {
  if (data.platform !== VIDEO_PLATFORM_DOUYIN || !data.secUid || !data.videoId) return null;
  const platformRow = await prisma.crawlSource.findUnique({
    where: { id: sourceId },
    select: { config: true },
  });
  const jars = jarsFromConfig(platformRow?.config);
  if (jars.length === 0) return null;
  const items = await douyinAdapter.fetchRecentVideos({
    secUid: data.secUid,
    cookies: jars,
    maxPages: SOCIAL_BACKFILL_MAX_PAGES,
  });
  return items.find((it) => it.videoId === data.videoId)?.playUrl ?? null;
}

/** ASR 管道内重试;终败返回 null(调用方降级 missing_transcript),不抛。
 * 批⑦:逐次落 ai_usage_log(成功记音频秒;终败记 degraded——缺转写降级口径) */
async function runTranscribeWithRetry(
  input: TranscribeInput,
  audioSeconds: number,
): Promise<{ text: string | null; error: string | null }> {
  let lastError = "";
  for (let attempt = 0; attempt <= ASR_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, ASR_RETRY_DELAY_MS));
    }
    const startedAt = Date.now();
    try {
      const text = await transcribeAudio(input);
      await recordAiUsage({
        role: AI_USAGE_ROLE_ASR,
        modelKey: input.modelId,
        audioSeconds,
        durationMs: Date.now() - startedAt,
      });
      return { text, error: null };
    } catch (err) {
      lastError = errMessage(err);
      logger.warn({
        event: "interpret.video.asr_retry",
        attempt: attempt + 1,
        error: lastError.slice(0, AI_ERR_DETAIL_MAX),
      });
    }
  }
  await recordAiUsage({
    role: AI_USAGE_ROLE_ASR,
    modelKey: input.modelId,
    audioSeconds,
    status: "degraded",
  });
  return { text: null, error: lastError };
}

/** LLM 调用 + 解析(解析重试在 chatJsonTask;网络/HTTP 错误上抛给 BullMQ attempts);
 * 批⑦:usage 角色入台账(备用=degraded,解析终败=failed) */
function runLlm(model: ResolvedAiModel, system: string, user: string) {
  return chatJsonTask(model, parseInterpretResult, system, user, AI_PURPOSE_INTERPRET);
}

/** worker「interpret-video」job 入口(管道状态机,分支语义见 InterpretOutcome) */
export async function interpretVideoJob(data: InterpretJobData): Promise<InterpretOutcome> {
  const id = BigInt(data.telegramId);
  const row = await prisma.telegram.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      summary: true,
      aiStatus: true,
      sourceId: true,
      videoDuration: true,
    },
  });
  if (!row)
    return { telegramId: data.telegramId, status: "skipped_not_found", transcriptUsed: false };
  if (row.aiStatus === TELEGRAM_AI_DONE) {
    return { telegramId: data.telegramId, status: "skipped_done", transcriptUsed: false };
  }

  const [asr, model] = await Promise.all([
    getAsrRuntimeConfig(),
    resolveAiModel(AI_PURPOSE_INTERPRET),
  ]);
  if (model === null) {
    // 未配置是运营态:aiStatus 不动,仅落提示(绑定后经补扫 tick 自然重试)
    await prisma.telegram.update({
      where: { id },
      data: { lastAiError: "解读未启用:interpret 模型未配置" },
    });
    return { telegramId: data.telegramId, status: "skipped_not_ready", transcriptUsed: false };
  }

  // 日配额(后台 interpret 绑定可配,缺省 100;只数视频行,与 summarize 配额互不侵占):
  // 满则延迟重投顺延,绝不 throw / 标败
  if (
    (await countTodayAiDone(TELEGRAM_MEDIA_VIDEO)) >= (await getRoleDailyMax(AI_PURPOSE_INTERPRET))
  ) {
    await getQueue(QUEUE_INTERPRETER).add(
      INTERPRET_JOB_NAME,
      data,
      aiJobOpts({
        jobId: interpretJobId(data.telegramId, `r${Date.now()}`),
        delayMs: QUOTA_DEFER_MS,
      }),
    );
    logger.warn({ event: "interpret.video.quota_deferred", telegramId: data.telegramId });
    return { telegramId: data.telegramId, status: "deferred_quota", transcriptUsed: false };
  }

  await prisma.telegram.update({
    where: { id },
    data: { aiStatus: TELEGRAM_AI_PROCESSING, lastAiError: null },
  });

  // 下载/抽轨/ASR(M12 起整段可选):ASR 未启用直接跳过;直链过境缺失且网关重拉
  // 未命中也不再硬失败——两者都降级「基于文案」概括(missing_transcript)。
  // 临时文件 try/finally 即删(版权红线);下载/网关网络层失败上抛给 BullMQ 重试
  let transcript: string | null = null;
  let transcriptError: string | null = null;
  if (asr?.enabled) {
    const tmpDir = await makeInterpretTmpDir();
    try {
      let playUrl = data.playUrl;
      if (!playUrl) playUrl = await fetchFreshPlayUrl(row.sourceId, data);
      if (playUrl) {
        const { videoPath, audioPath } = tmpMediaPaths(tmpDir);
        try {
          await downloadVideoToTmp(playUrl, videoPath);
        } catch (err) {
          // 过境直链是数小时有效的签名 URL,积压 job 会过期:重拉一次再试
          const fresh = await fetchFreshPlayUrl(row.sourceId, data);
          if (!fresh) throw err;
          await downloadVideoToTmp(fresh, videoPath);
        }
        await extractAudioMp3(videoPath, audioPath, asr.maxAudioSeconds);
        const asrResult = await runTranscribeWithRetry(
          {
            protocol: asr.protocol,
            baseUrl: asr.baseUrl,
            modelId: asr.modelId,
            apiKey: asr.apiKey,
            audio: await readAudioFile(audioPath),
            filename: "audio.mp3",
            hotwords: asr.hotwords,
            timeoutSec: ASR_TIMEOUT_SEC,
          },
          row.videoDuration ?? 0,
        );
        transcript = asrResult.text;
        transcriptError = asrResult.error;
      } else {
        transcriptError = "无可用播放直链(过境直链缺失且网关重拉未命中),基于文案概括";
      }
    } catch (err) {
      await markAiFailed(id, err);
      throw err; // 下载/网关网络层 → BullMQ attempts 兜重试
    } finally {
      await removeTmpDir(tmpDir).catch(() => undefined);
    }
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
    await markAiFailed(id, err);
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
