/**
 * 搜索 AI 答案卡问答留档(2026-11-17 站长裁定,arch/03 search_answer_log):
 * 答案卡是单轮问答无线程语义,此前只有 ai_usage_log 计量、内容仅 Redis 缓存
 * 1 天——「用户在问什么」的反馈闭环缺失。本模块落 ok/degraded/failed 三态
 * 问答行,90 天滚动清理(同 ai_usage_log 口径)。
 *
 * 纪律:**写失败只告警不反噬流**(同 touchGuestSessionAfterRun);返回新行 id
 * 串作 recordAiUsage 的 sessionId 锚(K2.6 线程锚同口径),失败返回 null。
 */
import { type Prisma } from "@prisma/client";

import { DAY_MS } from "@/lib/datetime";
import { deleteBatchedWhere, prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

import type { AnswerCite } from "./answer-protocol";

export type AnswerLogStatus = "ok" | "degraded" | "failed";

/** 保留期(天):worker 日清同口径 */
export const ANSWER_LOG_RETENTION_DAYS = 90;

const QUESTION_MAX = 120; // 上游 route 已 slice(100),落库防御
const ANSWER_MAX = 20_000; // LLM 输出受 ANSWER_MAX_TOKENS 约束,防御性截断

export interface AnswerLogInput {
  visitorId: string | null;
  question: string;
  /** ok/degraded=可见全文;failed=null */
  answer: string | null;
  cites: AnswerCite[];
  followUps?: string[];
  modelKey: string;
  durationMs: number;
  status: AnswerLogStatus;
}

/** 留档一行;写失败告警返回 null(不反噬 SSE 流) */
export async function recordAnswerLog(input: AnswerLogInput): Promise<string | null> {
  try {
    const row = await prisma.searchAnswerLog.create({
      data: {
        visitorId: input.visitorId,
        question: input.question.slice(0, QUESTION_MAX),
        answer: input.answer === null ? null : input.answer.slice(0, ANSWER_MAX),
        cites: {
          items: input.cites.map((c) => ({ ...c })),
          followUps: input.followUps ?? [],
        } satisfies Prisma.InputJsonValue,
        modelKey: input.modelKey,
        durationMs: input.durationMs,
        status: input.status,
      },
      select: { id: true },
    });
    return row.id.toString();
  } catch (e) {
    logger.warn({
      event: "search.answer_log_failed",
      status: input.status,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** 清理保留期前行数(手动触发与 worker cron 共用);分批防超时(同 usage-log) */
export async function purgeSearchAnswerOlderThan(
  days = ANSWER_LOG_RETENTION_DAYS,
): Promise<number> {
  return deleteBatchedWhere(prisma.searchAnswerLog, {
    createdAt: { lt: new Date(Date.now() - days * DAY_MS) },
  });
}
