/**
 * 查询侧向量化(M20 批③,arch/04 §3.2 混合检索):检索词 → embedding-3 向量,
 * 供 pgvector 余弦召回。降级纪律:未绑定 embedding 模型(功能关闭)或调用失败
 * → null,searchAll 纯词项路径,行为与单榜逐字节一致——语义层挂了检索不能挂。
 * 结果 Redis 缓存 24h(base64 Float32,key 绑 modelId 防换模型串缓存),
 * 热查询零延迟零配额消耗。
 */
import { createHash } from "node:crypto";

import { AI_PROTOCOL_OPENAI, AI_PURPOSE_EMBEDDING } from "../ai/constants";
import { embedTexts } from "../ai/embedding-client";
import { resolveAiModel } from "../ai/resolver";
import { recordAiUsage } from "../ai/usage-log";
import { logger } from "../logger";
import { redis } from "../redis";
import { EMBEDDING_DIMS } from "./embedding";

/** 查询向量缓存时长(24h;语料向量有对账自愈,查询侧无需更长) */
export const QUERY_EMBED_TTL_SEC = 86_400;

/** number[] → base64(Float32Array LE)(Redis 承载格式) */
export function encodeVectorB64(v: number[]): string {
  return Buffer.from(new Float32Array(v).buffer).toString("base64");
}

/** base64 → number[];字节长非 4 倍数/维度不符/含非有限值 = 缓存污染 → null */
export function decodeVectorB64(b64: string): number[] | null {
  const buf = Buffer.from(b64, "base64");
  if (buf.byteLength === 0 || buf.byteLength % 4 !== 0) return null;
  const arr = Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  return arr.length === EMBEDDING_DIMS && arr.every((n) => Number.isFinite(n)) ? arr : null;
}

/** 检索词向量(检索主流程唯一出口;null = 语义层不可用,检索继续) */
export async function embedQueryForSearch(q: string): Promise<number[] | null> {
  let model: Awaited<ReturnType<typeof resolveAiModel>>;
  try {
    model = await resolveAiModel(AI_PURPOSE_EMBEDDING);
  } catch {
    return null;
  }
  // embedding-client 仅 openai 兼容协议(智谱 embeddings 同协议);其余视为未绑定
  if (!model || model.protocol !== AI_PROTOCOL_OPENAI || !model.baseUrl) return null;

  const key = `search:emb:${model.modelId}:${createHash("sha1").update(q).digest("hex")}`;
  const cached = await redis.get(key).catch(() => null);
  if (cached) {
    const decoded = decodeVectorB64(cached);
    if (decoded) return decoded;
  }

  const startedAt = Date.now();
  try {
    const r = await embedTexts({
      protocol: model.protocol,
      baseUrl: model.baseUrl,
      modelId: model.modelId,
      apiKey: model.apiKey,
      timeoutSec: model.timeoutSec,
      texts: [q],
      dims: EMBEDDING_DIMS,
    });
    await recordAiUsage({
      role: AI_PURPOSE_EMBEDDING,
      modelId: model.id,
      modelKey: model.modelId,
      tokensIn: r.usage.tokensIn,
      durationMs: Date.now() - startedAt,
      status: "ok",
    });
    const vector = r.vectors[0]!;
    await redis.set(key, encodeVectorB64(vector), "EX", QUERY_EMBED_TTL_SEC).catch(() => {});
    return vector;
  } catch (e) {
    // 降级记 degraded(降级次数 KPI 口径);写台账失败不反噬,检索继续
    await recordAiUsage({
      role: AI_PURPOSE_EMBEDDING,
      modelId: model.id,
      modelKey: model.modelId,
      durationMs: Date.now() - startedAt,
      status: "degraded",
    }).catch(() => {});
    logger.warn({
      event: "search.embed_query_failed",
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
