/**
 * 洞察信号翻译(M58 批①,arch/01 §3.1):非中文源原文 → 中文译文,
 * 原文恒留 raw_text,译文落 translated_text 并顶替 normalized_text 进
 * embedding/聚类——跨语言同簇的前提。
 *
 * 状态机(none | pending | done | failed):
 * - 中文源 none;非中文源 ingest 时 pending,暂不进 embedding(embedding-repo 过滤);
 * - done:译文顶替归一文本,embedding 置空由下一轮 embed 重嵌(幂等);
 * - failed:保留原文归一文本,照常 embedding(翻译是增强,不阻塞采集);
 * - 防呆:pending 超 24h(角色未绑定/队列积压)自动降级 failed。
 *
 * 成本:单条 ≤1 次成功调用,失败重试 ≤2;sha1(rawText) → 译文 7 天缓存,
 * 跨源同文复用;用量按 role=translate 记账(AiTaskBinding/用量台可见)。
 * 永不 throw:单条失败只落 failed,批处理继续。
 */
import { createHash } from "node:crypto";

import { AI_PURPOSE_TRANSLATE } from "../ai/constants";
import { chatText } from "../ai/llm-client";
import { recordAiUsage } from "../ai/usage-log";
import { prisma } from "../db";
import { logger } from "../logger";
import { redis } from "../redis";
import { resolveInsightModel } from "./model";

/** 翻译输入/输出上限(与 normalizedText 同口径) */
const TRANSLATE_TEXT_MAX = 2000;
const CACHE_TTL_SEC = 7 * 24 * 3600;
const STALE_PENDING_MS = 24 * 3600 * 1000;
const RETRY_MAX = 2;
export const TRANSLATE_BATCH_SIZE = 10;

const TRANSLATE_SYSTEM = `你是专业翻译。把用户给出的非中文内容翻译成简体中文,只输出译文本身,不要任何解释、前缀或 Markdown 代码块。专有名词、模型名、公司名、产品名、代码命令、URL 保持原样不译;不增删信息,不总结。`;

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function cacheKey(text: string): string {
  return `insight:translate:${sha1(text)}`;
}

async function readCache(text: string): Promise<string | null> {
  try {
    return await redis.get(cacheKey(text));
  } catch {
    return null;
  }
}

async function writeCache(text: string, translated: string): Promise<void> {
  try {
    await redis.set(cacheKey(text), translated, "EX", CACHE_TTL_SEC);
  } catch {
    // 缓存非必需,失败不影响落库
  }
}

export type TranslateOutcome = "done" | "cached" | "failed" | "skipped" | "unbound";

/**
 * 单条翻译;仅处理 translation_status=pending 的行(幂等:重复 job 静默跳过)。
 * 失败只落 failed,永不 throw。
 */
export async function translateSignal(signalId: bigint): Promise<TranslateOutcome> {
  const row = await prisma.insightSignal.findFirst({
    where: { id: signalId, translationStatus: "pending" },
    select: { id: true, rawText: true, lang: true },
  });
  if (!row) return "skipped";
  const source = row.rawText.trim().slice(0, TRANSLATE_TEXT_MAX);

  const cached = await readCache(source);
  if (cached) {
    await markDone(row.id, cached);
    return "cached";
  }

  const model = await resolveInsightModel(AI_PURPOSE_TRANSLATE);
  if (!model?.baseUrl) {
    // 未绑定/解析失败:保持 pending,由 24h 降级兜底(不阻塞采集)
    return "unbound";
  }

  for (let attempt = 0; attempt <= RETRY_MAX; attempt += 1) {
    const startedAt = Date.now();
    try {
      const translated = await chatText(
        {
          protocol: model.protocol,
          baseUrl: model.baseUrl,
          modelId: model.modelId,
          apiKey: model.apiKey,
          system: TRANSLATE_SYSTEM,
          user: source,
          timeoutSec: model.timeoutSec,
          maxTokens: TRANSLATE_TEXT_MAX,
        },
        (usage) => {
          void recordAiUsage({
            role: AI_PURPOSE_TRANSLATE,
            modelId: model.id,
            modelKey: model.modelId,
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            durationMs: Date.now() - startedAt,
            status: "ok",
          });
        },
      );
      const text = translated.trim().slice(0, TRANSLATE_TEXT_MAX);
      if (text === "") throw new Error("译文为空");
      await markDone(row.id, text);
      await writeCache(source, text);
      return "done";
    } catch (e) {
      if (attempt < RETRY_MAX) continue;
      await markFailed(row.id);
      logger.warn({
        event: "insight.translate_failed",
        signalId: row.id.toString(),
        lang: row.lang,
        attempts: attempt + 1,
        error: e instanceof Error ? e.message : String(e),
      });
      return "failed";
    }
  }
  return "failed";
}

async function markDone(signalId: bigint, translated: string): Promise<void> {
  await prisma.insightSignal.updateMany({
    where: { id: signalId, translationStatus: "pending" },
    data: {
      translatedText: translated,
      // 译文顶替归一文本:embedding/聚类统一走中文口径;embedding 仍为 null,
      // 下一轮 findUnembeddedSignals 自然重嵌(幂等,不重复计费)
      normalizedText: translated,
      translationStatus: "done",
    },
  });
}

async function markFailed(signalId: bigint): Promise<void> {
  await prisma.insightSignal.updateMany({
    where: { id: signalId, translationStatus: "pending" },
    data: { translationStatus: "failed" },
  });
}

/** pending 超 24h 自动降级(角色未绑定/队列积压/worker 停机),避免永久卡池。
 * 返回降级条数;供翻译扫尾与 embed 批共同调用(双保险)。 */
export async function degradeStalePendingTranslations(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PENDING_MS);
  const r = await prisma.insightSignal.updateMany({
    where: { translationStatus: "pending", createdAt: { lt: cutoff } },
    data: { translationStatus: "failed" },
  });
  if (r.count > 0) {
    logger.warn({ event: "insight.translate_stale_degraded", count: r.count });
  }
  return r.count;
}

export interface TranslateSummary {
  pending: number;
  done: number;
  cached: number;
  failed: number;
  skipped: number;
  /** translate 角色未绑定(pending 保持,24h 后降级) */
  unbound: boolean;
}

/** 扫尾批(10min cron + 手动脚本共用):先降级超时 pending,再补翻在池 pending。
 * 未绑定模型时仍执行降级,随后整轮跳过。 */
export async function runInsightTranslateBatch(
  limit: number = TRANSLATE_BATCH_SIZE,
): Promise<TranslateSummary> {
  const summary: TranslateSummary = {
    pending: 0,
    done: 0,
    cached: 0,
    failed: 0,
    skipped: 0,
    unbound: false,
  };
  await degradeStalePendingTranslations();

  const rows = await prisma.insightSignal.findMany({
    where: { translationStatus: "pending" },
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true },
  });
  summary.pending = rows.length;
  if (rows.length === 0) return summary;

  for (const row of rows) {
    const outcome = await translateSignal(row.id);
    if (outcome === "done") summary.done += 1;
    else if (outcome === "cached") summary.cached += 1;
    else if (outcome === "failed") summary.failed += 1;
    else if (outcome === "unbound") summary.unbound = true;
    else summary.skipped += 1;
    // 未绑定:后续行同样无法翻译,退出本轮(降级已在上方执行)
    if (summary.unbound) break;
  }
  if (summary.done + summary.cached + summary.failed > 0) {
    logger.info({ event: "insight.translate_batch", ...summary });
  }
  return summary;
}
