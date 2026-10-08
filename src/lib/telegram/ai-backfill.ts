/**
 * AI 解读存量补扫(M12 批③):解读/摘要能力后配置、或入库时直链缺失的存量,
 * 由 5 分钟 tick 兜底——扫 ai_status IS NULL、近 7 天发布(SOCIAL_BACKFILL_DAYS
 * 同窗)的可见条,视频/文字两类各限 5 条,分流入 interpreter/summarizer 队列。
 * **最新优先**(批⑤ 2026-10-05 验收反馈):信息流头部最先见到 AI 行——旧→新
 * 排序会让最旧的先消化,用户看流首长期「仍然没有解读」;存量有限且新入库走
 * ingest 钩子即时入队,饿死风险可忽略。
 * 就绪检查整轮一次(未绑定模型不入队,防 skipped_not_ready 的 5 分钟重投空转);
 * 入队前移除同名遗留 job(completed 保留窗口会顶掉同 jobId 重复入队,静默去重),
 * 先标 pending 防下一轮重扫;单条入队失败只跳过该条,不拖垮整轮。
 */
import { prisma } from "../db";
import { logger } from "../logger";
import { getQueue, QUEUE_INTERPRETER, QUEUE_SUMMARIZER } from "../queue";

import { markAiPendingAndEnqueue } from "./ai-shared";
import {
  SOCIAL_BACKFILL_DAYS,
  TELEGRAM_MEDIA_TEXT,
  TELEGRAM_MEDIA_VIDEO,
  TELEGRAM_STATUS_VISIBLE,
} from "./constants";
import { enqueueInterpret, isInterpretReady, interpretJobId } from "./interpret-video";
import { enqueueSummarize, isSummarizeReady, summarizeJobId } from "./summarize-text";

/** 每轮每类条数上限(两路共 10 条/5min,日配额缺省 100 足以消化) */
export const AI_BACKFILL_PER_TYPE = 5;

export interface AiBackfillOutcome {
  video: number;
  text: number;
}

/** worker「ai-backfill」job 入口(crawler 队列 ai-backfill-tick 每 5min 调度) */
export async function backfillAiPending(): Promise<AiBackfillOutcome> {
  const outcome: AiBackfillOutcome = { video: 0, text: 0 };
  const since = new Date(Date.now() - SOCIAL_BACKFILL_DAYS * 86_400_000);
  const baseWhere = {
    aiStatus: null,
    status: TELEGRAM_STATUS_VISIBLE,
    OR: [{ publishedAt: { gt: since } }, { publishedAt: null, createdAt: { gt: since } }],
  };
  const [interpretReady, summarizeReady, videoRows, textRows] = await Promise.all([
    isInterpretReady(),
    isSummarizeReady(),
    prisma.telegram.findMany({
      where: { ...baseWhere, mediaType: TELEGRAM_MEDIA_VIDEO },
      select: { id: true, url: true, videoPlatform: true, videoBlogger: true },
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: AI_BACKFILL_PER_TYPE,
    }),
    prisma.telegram.findMany({
      where: { ...baseWhere, mediaType: TELEGRAM_MEDIA_TEXT },
      select: { id: true },
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: AI_BACKFILL_PER_TYPE,
    }),
  ]);

  if (interpretReady) {
    for (const row of videoRows) {
      const id = row.id;
      try {
        // videoId 从 canonical 外链尾段解析(telegram-admin 同款);secUid 经博主台账反查
        const videoId = row.url?.match(/\/video\/([\w-]+)/)?.[1] ?? null;
        const account = await prisma.socialAccount.findFirst({
          where: { platform: row.videoPlatform ?? "", nickname: row.videoBlogger ?? "" },
          select: { secUid: true },
        });
        await getQueue(QUEUE_INTERPRETER)
          .remove(interpretJobId(id.toString()))
          .catch(() => null);
        await markAiPendingAndEnqueue(id, () =>
          enqueueInterpret({
            telegramId: id.toString(),
            videoId,
            playUrl: null, // 过境直链不落库,processor 现场重拉,拉不到降级文案解读
            platform: row.videoPlatform ?? "",
            secUid: account?.secUid ?? null,
          }),
        );
        outcome.video += 1;
      } catch (err) {
        logger.warn({
          event: "ai.backfill.video_enqueue_failed",
          telegramId: id.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (summarizeReady) {
    for (const row of textRows) {
      const id = row.id;
      try {
        await getQueue(QUEUE_SUMMARIZER)
          .remove(summarizeJobId(id.toString()))
          .catch(() => null);
        await markAiPendingAndEnqueue(id, () => enqueueSummarize({ telegramId: id.toString() }));
        outcome.text += 1;
      } catch (err) {
        logger.warn({
          event: "ai.backfill.text_enqueue_failed",
          telegramId: id.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (outcome.video > 0 || outcome.text > 0) {
    logger.info({ event: "ai.backfill.done", ...outcome });
  }
  return outcome;
}
