/**
 * 解读转写获取段(技术债批⑤,自 interpret-video 抽出):字幕优先(M33 批C,
 * 适配器声明 resolveSubtitleText 的平台先行,拿得到整段跳过 playurl/下载/ASR)
 * → ASR 分段转写(M27 批⑦:ffmpeg 5min 切片,逐段独立超时/重试预算按序拼接)
 * 。三路皆不得返回 transcript=null + 人话 transcriptError,调用方降级
 * 「基于文案」概括(missing_transcript)。版权红线:临时音视频 try/finally 即删;
 * 网络层错误原样上抛,风控门判定与顺延重投留 interpret-video(依赖队列身份)。
 */
import { transcribeAudio, type TranscribeInput } from "../ai/asr-client";
import type { AsrRuntimeConfig } from "../ai/asr-admin";
import { AI_ERR_DETAIL_MAX } from "../ai/constants";
import { recordAiUsage, AI_USAGE_ROLE_ASR } from "../ai/usage-log";
import { prisma } from "../db";
import { logger } from "../logger";
import path from "node:path";

import {
  downloadVideoToTmp,
  extractAudioSegments,
  makeInterpretTmpDir,
  readAudioFile,
  removeTmpDir,
  tmpMediaPaths,
} from "../media/interpret-media";

import { errMessage } from "./ai-shared";
import type { VideoPlatform } from "./constants";
import { downloadHeadersFor } from "./adapters/video";
import { ADAPTERS } from "./adapters/video/registry";
import { jarsFromConfig } from "./cookies";
import { getEgressProxyRuntime } from "./egress-proxy";
import type { InterpretJobData } from "./interpret-video";

const ASR_RETRIES = 2; // 管道内重试(首次 + 2 重试);终败降级不抛
const ASR_RETRY_DELAY_MS = 3_000;
const ASR_TIMEOUT_SEC = 120;
/** 长视频分段转写(M27 批⑦):ffmpeg 按 5min 切片,逐段独立吃 ASR 超时/重试
 * 预算,按序拼接(单段直传 120s 死线是 10min+ 视频必挂的第二根因);任一段
 * 终败整体降级 missing_transcript——半篇转写以偏概全,不硬凑 */
const ASR_SEGMENT_SECONDS = 300;

/** 经适配器现查直链(存量补读/过境链过期两路;M24 起按平台分发:
 * douyin=重拉 listing 匹配,bilibili=网关 /play-url),查不得返回 null
 * → 调用方既有 missing_transcript 降级 */
async function fetchFreshPlayUrl(sourceId: number, data: InterpretJobData): Promise<string | null> {
  const adapter = ADAPTERS[data.platform as VideoPlatform];
  if (!adapter?.resolvePlayUrl || !data.secUid || !data.videoId) return null;
  const platformRow = await prisma.crawlSource.findUnique({
    where: { id: sourceId },
    select: { config: true },
  });
  const jars = jarsFromConfig(platformRow?.config);
  if (jars.length === 0) return null;
  // 出口代理(M33 批B):同采集一路,启用即随网关请求携带(未配置=直连)
  const egress = await getEgressProxyRuntime();
  return adapter.resolvePlayUrl({
    videoId: data.videoId,
    secUid: data.secUid,
    cookies: jars,
    ...(egress ? { proxy: egress.proxyUrl } : {}),
  });
}

/** 字幕文本现查(M33 批C 字幕优先,适配器声明 resolveSubtitleText 的平台
 * 才走,B站先行):null=无字幕/缺 jars/不支持 → 调用方落回直链+ASR 既有
 * 管道;RiskControl/NoJarAvailable 照常上抛,进既有风控门顺延分支 */
async function fetchSubtitleText(
  sourceId: number,
  data: InterpretJobData,
): Promise<{ text: string; lang: string | null } | null> {
  const adapter = ADAPTERS[data.platform as VideoPlatform];
  if (!adapter?.resolveSubtitleText || !data.videoId) return null;
  const platformRow = await prisma.crawlSource.findUnique({
    where: { id: sourceId },
    select: { config: true },
  });
  const jars = jarsFromConfig(platformRow?.config);
  if (jars.length === 0) return null;
  const egress = await getEgressProxyRuntime();
  return adapter.resolveSubtitleText({
    videoId: data.videoId,
    cookies: jars,
    ...(egress ? { proxy: egress.proxyUrl } : {}),
  });
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

/** 取转写(字幕 → ASR 分段),见文件头。asr 由调用方判 enabled 后传入;
 * transcriptError 为人话降级口径(落 lastAiError)。 */
export async function acquireTranscript(opts: {
  sourceId: number;
  data: InterpretJobData;
  asr: AsrRuntimeConfig;
}): Promise<{ transcript: string | null; transcriptError: string | null }> {
  const { sourceId, data, asr } = opts;
  const subtitle = await fetchSubtitleText(sourceId, data);
  if (subtitle) return { transcript: subtitle.text, transcriptError: null };

  const tmpDir = await makeInterpretTmpDir();
  try {
    let playUrl = data.playUrl;
    if (!playUrl) playUrl = await fetchFreshPlayUrl(sourceId, data);
    if (!playUrl) {
      return {
        transcript: null,
        transcriptError: "无可用播放直链(过境直链缺失且网关重拉未命中),基于文案概括",
      };
    }
    const { videoPath } = tmpMediaPaths(tmpDir);
    // B站 CDN 防盗链校验 Referer(douyin 空对象,douyin 行为不变)
    const headers = downloadHeadersFor(data.platform);
    try {
      await downloadVideoToTmp(playUrl, videoPath, headers);
    } catch (err) {
      // 过境直链是数小时有效的签名 URL,积压 job 会过期:重拉一次再试
      const fresh = await fetchFreshPlayUrl(sourceId, data);
      if (!fresh) throw err;
      await downloadVideoToTmp(fresh, videoPath, headers);
    }
    // 分段转写(M27 批⑦):逐段独立重试/超时预算,按序拼接;usage 按段记账
    const segPaths = await extractAudioSegments(
      videoPath,
      tmpDir,
      asr.maxAudioSeconds,
      ASR_SEGMENT_SECONDS,
    );
    const parts: string[] = [];
    for (const [i, segPath] of segPaths.entries()) {
      const segSeconds = Math.max(
        Math.min(asr.maxAudioSeconds - i * ASR_SEGMENT_SECONDS, ASR_SEGMENT_SECONDS),
        0,
      );
      const asrResult = await runTranscribeWithRetry(
        {
          protocol: asr.protocol,
          baseUrl: asr.baseUrl,
          modelId: asr.modelId,
          apiKey: asr.apiKey,
          audio: await readAudioFile(segPath),
          filename: path.basename(segPath),
          hotwords: asr.hotwords,
          timeoutSec: ASR_TIMEOUT_SEC,
        },
        segSeconds,
      );
      if (asrResult.text === null) {
        return {
          transcript: null,
          transcriptError: `分段转写失败(第 ${i + 1}/${segPaths.length} 段):${asrResult.error}`,
        }; // 半篇转写以偏概全:已得段一并弃用,整体降级文案概括
      }
      parts.push(asrResult.text);
    }
    return { transcript: parts.join("\n"), transcriptError: null };
  } finally {
    await removeTmpDir(tmpDir).catch(() => undefined);
  }
}
