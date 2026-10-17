/**
 * 视频解读(M9,arch/02 §3.2;M12 批③ 默认化):interpreter 队列编排——下载无水印
 * 流(批⑦ 流式落盘)→ ffmpeg 抽音轨按段切片 → 云 ASR 逐段转写按序拼接(批⑦ 长视频)→
 * telegram.ai_* 列落库。转写获取段(字幕优先/分段 ASR)已拆 interpret-transcript
 * (技术债批⑤),本件留 job 状态机:就绪判定/配额与风控门顺延/LLM 概括/解读笔记
 * 落库。M12 起就绪条件解耦 ASR:仅 interpret 绑定即开动,ASR 未启用/直链不可得时
 * 降级「基于文案」概括,配 ASR 即增强。M26 批②起转写可用轮次追加解读笔记二次调用
 * (ai_note,ai/interpret-note;失败置 null 不阻塞解读终态)。版权红线:「转写是输入,
 * 不是资产」——不设 transcript 列,play_url 仅经 job data 过境(removeOnComplete/
 * Fail 50 压 Redis 痕迹)。ASR 终败(重试≤2)→ missing_transcript 降级,不阻塞入流。
 * 三层重试语义:ASR/LLM 解析失败在管道内兜住;下载/网关/LLM 网络层上抛给 BullMQ
 * attempts;B站 playurl 风控门(M24)为分钟~小时级上下文门,60s 退避跨不过——
 * 延迟重投顺延(RISK_CONTROL_*)跨门自愈,顺延耗尽才终败。
 */
import { getAsrRuntimeConfig } from "../ai/asr-admin";
import { chatJsonTask } from "../ai/chat-json-task";
import { AI_PURPOSE_INTERPRET } from "../ai/constants";
import { AiClientError } from "../ai/errors";
import { buildInterpretPrompt, parseInterpretResult } from "../ai/interpret-result";
import { runInterpretNote } from "../ai/interpret-note";
import { getRoleDailyMax, resolveAiModel, type ResolvedAiModel } from "../ai/resolver";
import { prisma } from "../db";
import { ingestInsightSignal } from "../insight/ingest";
import { logger } from "../logger";

import { getQueue, QUEUE_INTERPRETER } from "../queue";

import { aiJobOpts, markAiFailed, markAiPendingAndEnqueue } from "./ai-shared";
import {
  TELEGRAM_AI_DONE,
  TELEGRAM_AI_MISSING_TRANSCRIPT,
  TELEGRAM_AI_PROCESSING,
  TELEGRAM_MEDIA_VIDEO,
} from "./constants";
import { acquireTranscript } from "./interpret-transcript";
import { GatewayUpstreamError } from "./adapters/video";
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
  /** B站 playurl 风控门顺延计数(延迟重投自增;超出 RISK_CONTROL_DEFER_SCHEDULE_MS 即放弃重试降级) */
  deferCount?: number;
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
    | "deferred_quota"
    | "deferred_riskcontrol";
  transcriptUsed: boolean;
  error?: string;
}

const QUOTA_DEFER_MS = 30 * 60_000;
/** B站 playurl 软风控门顺延节奏(M30 批A 收口):门为分钟~小时级上下文门,
 * 延迟重投跨门——20min 跨短门、2h 跨长门,仍门即放弃重试降级「基于文案概括」。
 * 2026-10-14 生产实证:单视频 voucher 门 3 天 48 趟(20min×3 无上限顺延=全天候
 * 喂门训练),每趟冷却池里唯一 jar,采集被连带全灭——顺延必须有终点。
 * 池耗尽(NoJarAvailableError)同路顺延:等的就是同一份冷却,归因不同节奏同 */
const RISK_CONTROL_DEFER_SCHEDULE_MS = [20 * 60_000, 2 * 60 * 60_000];

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
      publishedAt: true, // 洞察信号 signalAt 锚(M34 批①,发表时间优先于解读时间)
      createdAt: true,
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

  // 转写获取(字幕优先/ASR 分段,技术债批⑤拆 interpret-transcript):ASR 未启用
  // 直接跳过;直链过境缺失且网关重拉未命中也不再硬失败——两者都降级「基于文案」
  // 概括(missing_transcript)。临时文件 try/finally 即删(版权红线);下载/网关
  // 网络层失败上抛给 BullMQ 重试
  let transcript: string | null = null;
  let transcriptError: string | null = null;
  try {
    if (asr?.enabled) {
      ({ transcript, transcriptError } = await acquireTranscript({
        sourceId: row.sourceId,
        data,
        asr,
      }));
    }
  } catch (err) {
    // B站 playurl 软风控门(v_voucher,经 resolvePlayUrl)与字幕链/player v2
    // 风控、池耗尽(NoJarAvailable,等的就是同一份冷却):按节奏延迟重投顺延
    // 跨门(行留 processing);节奏耗尽仍门 → 放弃重试降级「基于文案概括」
    // (可治理台「重解读」)。下载/其余网关网络层照旧上抛 attempts
    const riskGate =
      err instanceof GatewayUpstreamError &&
      (err.kind === "RiskControlError" || err.kind === "NoJarAvailableError");
    if (riskGate && (data.deferCount ?? 0) < RISK_CONTROL_DEFER_SCHEDULE_MS.length) {
      const deferCount = (data.deferCount ?? 0) + 1;
      await prisma.telegram.update({
        where: { id },
        data: {
          lastAiError: `风控门顺延重试中(${deferCount}/${RISK_CONTROL_DEFER_SCHEDULE_MS.length})`,
        },
      });
      await getQueue(QUEUE_INTERPRETER).add(
        INTERPRET_JOB_NAME,
        { ...data, deferCount },
        aiJobOpts({
          jobId: interpretJobId(data.telegramId, `rc${Date.now()}`),
          delayMs: RISK_CONTROL_DEFER_SCHEDULE_MS[data.deferCount ?? 0],
        }),
      );
      logger.warn({
        event: "interpret.video.riskcontrol_deferred",
        telegramId: data.telegramId,
        kind: err.kind,
        deferCount,
      });
      return {
        telegramId: data.telegramId,
        status: "deferred_riskcontrol",
        transcriptUsed: false,
      };
    }
    if (riskGate) {
      // 顺延节奏耗尽:不硬失败烧 attempts,降级缺转写概括,终态可见 lastAiError
      transcriptError = "风控门未过(顺延重试耗尽),基于文案概括";
    } else {
      await markAiFailed(id, err);
      throw err; // 下载/网关网络层 → BullMQ attempts 兜重试
    }
  }

  // LLM 概括(ASR/字幕终败降级:仅基于文案元数据,公开信息不触红线)
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

  // 解读笔记(M26 批②,方案 §4):仅转写可用轮产出——文案降级缺时间线叙事材料,
  // 不硬凑(同存量不补口径);失败置 null 不阻塞解读终态,lastAiError 契约不变
  // (终败详情在 ai/interpret-note 重试事件里)
  let note: string | null = null;
  if (transcript !== null) {
    note = (await runInterpretNote(model, { title: row.title, caption: row.summary, transcript }))
      .note;
    if (note === null) {
      logger.warn({ event: "interpret.video.note_failed", telegramId: data.telegramId });
    }
  }

  const status = transcript === null ? TELEGRAM_AI_MISSING_TRANSCRIPT : TELEGRAM_AI_DONE;
  await prisma.telegram.update({
    where: { id },
    data: {
      aiStatus: status,
      aiTopic: result.topic,
      aiSummary: result.summary,
      aiPoints: result.points,
      aiNote: note,
      aiRanAt: new Date(),
      lastAiError: transcriptError,
    },
  });
  logger.info({
    event: "interpret.video.done",
    telegramId: data.telegramId,
    status,
    transcriptUsed: transcript !== null,
    noteUsed: note !== null,
  });
  // 洞察信号入池(M34 批①):AI 解读产物=行业动态信号(热点引擎主料),
  // 仅终态 done 记;fire-and-forget(ingest 自吞异常,解读主链路不感知)
  if (status === TELEGRAM_AI_DONE) {
    void ingestInsightSignal({
      source: "telegram-ai",
      refId: id.toString(),
      rawText: result.summary,
      signalAt: row.publishedAt ?? row.createdAt,
      meta: { title: row.title, topic: result.topic },
    });
  }
  return { telegramId: data.telegramId, status, transcriptUsed: transcript !== null };
}
