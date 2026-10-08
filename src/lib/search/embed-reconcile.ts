/**
 * embedding 对账 job(M20 批②,arch/04 §3.2 混合检索):扫 stale 三域 → 构造文本 →
 * 批量 embed → upsert 向量;顺带清理孤儿向量(下架/软删/隐藏)。
 * 取向:对账式自愈(每 15 分钟)而非侵入三条内容管道——发布/入库链路零改动,
 * 新内容最迟一个周期可被语义召回。未绑定 embedding 模型 = 功能关闭,记日志跳过。
 * 单批失败不抛(下轮重扫自愈);用量逐次落 ai_usage_log(role=embedding)。
 */
import { AI_PURPOSE_EMBEDDING } from "../ai/constants";
import { resolveAiModel } from "../ai/resolver";
import { embedTexts, EMBED_BATCH_SIZE } from "../ai/embedding-client";
import { recordAiUsage } from "../ai/usage-log";
import { logger } from "../logger";
import {
  EMBEDDING_DIMS,
  buildPostEmbedText,
  buildRepoEmbedText,
  buildTelegramEmbedText,
  type EmbedEntityType,
} from "./embedding";
import {
  type EmbedSourceRef,
  type EmbedUpsertRow,
  cleanupOrphanEmbeddings,
  fetchPostEmbedSources,
  fetchRepoEmbedSources,
  fetchTelegramEmbedSources,
  findStaleEmbedSources,
  upsertEmbeddings,
} from "./embedding-repo";

/** 单轮对账条数上限(120 条 ≈ 10 次 embed 调用,秒级;存量回填多轮跑完) */
export const EMBED_RECONCILE_BATCH = 120;

export interface ReconcileSummary {
  /** 本轮扫到 stale 源行数(0=向量库已同步) */
  scanned: number;
  embedded: number;
  failed: number;
  /** 孤儿向量清理行数 */
  cleaned: number;
  /** embedding 模型未绑定(功能关闭),本轮跳过 */
  skipped: boolean;
}

/** 三域源行 → embedding 文本(区分度在各域 builder;此处只做分发) */
async function buildEmbedTexts(
  refs: EmbedSourceRef[],
): Promise<{ refs: EmbedSourceRef[]; texts: string[] }> {
  const byType = (t: EmbedEntityType): EmbedSourceRef[] => refs.filter((r) => r.entityType === t);
  const pairs: Array<{ ref: EmbedSourceRef; text: string }> = [];

  const postIds = byType("post").map((r) => r.entityId);
  if (postIds.length > 0) {
    const map = await fetchPostEmbedSources(postIds);
    for (const ref of byType("post")) {
      const src = map.get(ref.entityId);
      if (src) pairs.push({ ref, text: buildPostEmbedText(src) });
    }
  }
  const tgIds = byType("telegram").map((r) => r.entityId);
  if (tgIds.length > 0) {
    const map = await fetchTelegramEmbedSources(tgIds);
    for (const ref of byType("telegram")) {
      const src = map.get(ref.entityId);
      if (src) pairs.push({ ref, text: buildTelegramEmbedText(src) });
    }
  }
  const repoIds = byType("repo").map((r) => r.entityId);
  if (repoIds.length > 0) {
    const map = await fetchRepoEmbedSources(repoIds);
    for (const ref of byType("repo")) {
      const src = map.get(ref.entityId);
      if (src) pairs.push({ ref, text: buildRepoEmbedText(src) });
    }
  }
  return {
    refs: pairs.filter((p) => p.text.trim() !== "").map((p) => p.ref),
    texts: pairs.filter((p) => p.text.trim() !== "").map((p) => p.text),
  };
}

/** 对账主流程(worker cron 与手动脚本共用;process 级自愈,不抛) */
export async function reconcileEmbeddings(): Promise<ReconcileSummary> {
  const cleaned = await cleanupOrphanEmbeddings();
  const stale = await findStaleEmbedSources(EMBED_RECONCILE_BATCH);
  if (stale.length === 0) return { scanned: 0, embedded: 0, failed: 0, cleaned, skipped: false };

  const model = await resolveAiModel(AI_PURPOSE_EMBEDDING);
  if (!model) {
    logger.info({
      event: "embed.reconcile_skipped",
      reason: "embedding_unbound",
      stale: stale.length,
    });
    return { scanned: stale.length, embedded: 0, failed: 0, cleaned, skipped: true };
  }

  const { refs, texts } = await buildEmbedTexts(stale);
  const upserts: EmbedUpsertRow[] = [];
  let failed = 0;

  for (let i = 0; i < refs.length; i += EMBED_BATCH_SIZE) {
    const chunkRefs = refs.slice(i, i + EMBED_BATCH_SIZE);
    const chunkTexts = texts.slice(i, i + EMBED_BATCH_SIZE);
    const startedAt = Date.now();
    try {
      const r = await embedTexts({
        protocol: model.protocol,
        baseUrl: model.baseUrl,
        modelId: model.modelId,
        apiKey: model.apiKey,
        timeoutSec: model.timeoutSec,
        texts: chunkTexts,
        dims: EMBEDDING_DIMS,
      });
      chunkRefs.forEach((ref, j) =>
        upserts.push({
          entityType: ref.entityType,
          entityId: ref.entityId,
          model: model.modelId,
          vector: r.vectors[j]!,
        }),
      );
      await recordAiUsage({
        role: AI_PURPOSE_EMBEDDING,
        modelId: model.id,
        modelKey: model.modelId,
        tokensIn: r.usage.tokensIn,
        durationMs: Date.now() - startedAt,
        status: "ok",
      });
    } catch (e) {
      failed += chunkRefs.length;
      await recordAiUsage({
        role: AI_PURPOSE_EMBEDDING,
        modelId: model.id,
        modelKey: model.modelId,
        durationMs: Date.now() - startedAt,
        status: "failed",
      });
      logger.warn({
        event: "embed.chunk_failed",
        count: chunkRefs.length,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (upserts.length > 0) await upsertEmbeddings(upserts);
  const summary: ReconcileSummary = {
    scanned: stale.length,
    embedded: upserts.length,
    failed,
    cleaned,
    skipped: false,
  };
  logger.info({ event: "embed.reconcile", ...summary });
  return summary;
}
