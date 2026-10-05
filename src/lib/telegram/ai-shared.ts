/**
 * AI 解读任务共用件(M12 批③ 自 interpret-video 抽出):pending 标记+入队事务、
 * 终败落库、job 保留策略。interpret(视频)与 summarize(文字)两个编排器同构复用。
 */
import type { JobsOptions } from "bullmq";

import { prisma } from "../db";

import { TELEGRAM_AI_ERROR_MAX, TELEGRAM_AI_FAILED, TELEGRAM_AI_PENDING } from "./constants";

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 终败落库(failed + 错误详情截断);更新失败吞掉(别盖掉原始错误) */
export async function markAiFailed(id: bigint, err: unknown): Promise<void> {
  await prisma.telegram
    .update({
      where: { id },
      data: {
        aiStatus: TELEGRAM_AI_FAILED,
        lastAiError: errMessage(err).slice(0, TELEGRAM_AI_ERROR_MAX),
      },
    })
    .catch(() => undefined);
}

/** 「先标 pending → 入队,失败回滚 null」单一入口(手动触发/采集钩子/补扫共用,
 * 原地双实现收敛)。顺序不可反:worker 可能在入队返回前就开跑,反序会把
 * processing 打回 pending。入队动作由调用方闭包给出(两类 job payload 各异)。 */
export async function markAiPendingAndEnqueue(
  telegramId: bigint,
  enqueue: () => Promise<void>,
): Promise<void> {
  await prisma.telegram.update({
    where: { id: telegramId },
    data: { aiStatus: TELEGRAM_AI_PENDING, lastAiError: null },
  });
  try {
    await enqueue();
  } catch (err) {
    await prisma.telegram
      .update({ where: { id: telegramId }, data: { aiStatus: null } })
      .catch(() => undefined);
    throw err;
  }
}

/** AI job 通用参数(attempts 兜下载/网关/LLM 网络层;保留窗口 50 压过境数据在
 * Redis 的残留;delay 用于日配额满的顺延重投) */
export function aiJobOpts(opts: { jobId: string; delayMs?: number }): JobsOptions {
  return {
    jobId: opts.jobId,
    ...(opts.delayMs !== undefined ? { delay: opts.delayMs } : {}),
    attempts: 3,
    backoff: { type: "fixed", delay: 60_000 },
    removeOnComplete: 50,
    removeOnFail: 50,
  };
}
