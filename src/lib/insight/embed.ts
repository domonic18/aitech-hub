/**
 * 洞察 embedding 回填 + 增量聚类批处理(M34 批②,方案 §5.2/§5.3):高频轻
 * job(向量调用为主,零 LLM 归纳开销)——回填未嵌信号 → 就地增量聚类,新信号
 * 最迟一个周期归簇(EMBED_RECONCILE 同取向:对账式自愈,不侵入五路入池链)。
 * 未绑定 embedding 模型 = 功能关闭,记日志跳过;单 chunk 失败不抛,下轮重扫。
 * 用量逐次落 ai_usage_log(role=embedding,与三域对账同角色同口径)。
 */
import { AI_PURPOSE_EMBEDDING } from "../ai/constants";
import { embedTexts, EMBED_BATCH_SIZE } from "../ai/embedding-client";
import { recordAiUsage } from "../ai/usage-log";
import { resolveAiModel } from "../ai/resolver";
import { logger } from "../logger";
import { CLUSTER_BATCH_SIZE } from "./constants";
import { runInsightClustering } from "./cluster";
import { findUnembeddedSignals, saveSignalEmbeddings } from "./embedding-repo";
import { EMBEDDING_DIMS } from "../search/embedding";

export interface InsightEmbedSummary {
  /** 本轮回填向量数 */
  embedded: number;
  /** 回填失败数(chunk 级) */
  failed: number;
  /** 聚类:归簇/建簇/过短跳过/失败 */
  joined: number;
  created: number;
  short: number;
  clusterFailed: number;
  /** embedding 模型未绑定(功能关闭),本轮整体跳过 */
  skipped: boolean;
}

/** 单轮批处理(worker cron 与手动脚本共用;process 级自愈,不抛) */
export async function runInsightEmbedBatch(
  limit: number = CLUSTER_BATCH_SIZE,
): Promise<InsightEmbedSummary> {
  const empty: InsightEmbedSummary = {
    embedded: 0,
    failed: 0,
    joined: 0,
    created: 0,
    short: 0,
    clusterFailed: 0,
    skipped: false,
  };
  const model = await resolveAiModel(AI_PURPOSE_EMBEDDING);
  if (!model) {
    logger.info({ event: "insight.embed_skipped", reason: "embedding_unbound" });
    return { ...empty, skipped: true };
  }

  const signals = await findUnembeddedSignals(limit);
  let failed = 0;
  if (signals.length > 0) {
    for (let i = 0; i < signals.length; i += EMBED_BATCH_SIZE) {
      const chunk = signals.slice(i, i + EMBED_BATCH_SIZE);
      const startedAt = Date.now();
      try {
        const r = await embedTexts({
          protocol: model.protocol,
          baseUrl: model.baseUrl,
          modelId: model.modelId,
          apiKey: model.apiKey,
          timeoutSec: model.timeoutSec,
          texts: chunk.map((s) => s.normalizedText),
          dims: EMBEDDING_DIMS,
        });
        await saveSignalEmbeddings(chunk.map((s, j) => ({ id: s.id, vector: r.vectors[j]! })));
        await recordAiUsage({
          role: AI_PURPOSE_EMBEDDING,
          modelId: model.id,
          modelKey: model.modelId,
          tokensIn: r.usage.tokensIn,
          durationMs: Date.now() - startedAt,
          status: "ok",
        });
      } catch (e) {
        failed += chunk.length;
        await recordAiUsage({
          role: AI_PURPOSE_EMBEDDING,
          modelId: model.id,
          modelKey: model.modelId,
          durationMs: Date.now() - startedAt,
          status: "failed",
        });
        logger.warn({
          event: "insight.embed_chunk_failed",
          count: chunk.length,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  const clustering = await runInsightClustering(limit);
  const summary: InsightEmbedSummary = {
    embedded: signals.length - failed,
    failed,
    joined: clustering.joined,
    created: clustering.created,
    short: clustering.short,
    clusterFailed: clustering.failed,
    skipped: false,
  };
  if (summary.embedded > 0 || summary.joined > 0 || summary.created > 0) {
    logger.info({ event: "insight.embed_batch", ...summary });
  }
  return summary;
}
