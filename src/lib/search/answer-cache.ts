/**
 * 答案缓存(K2):同归一问句 24h 复用(Redis,只缓存成功生成);
 * 缓存命中仍计配额(answer-service 落 tokens 0 行),降级/断流不写。
 * Redis 异常吞掉(缓存 miss 放行生成),范式照 content/legacy.ts。
 */
import { createHash } from "node:crypto";

import { redis } from "@/lib/redis";

import type { AnswerCite } from "./answer-protocol";

const CACHE_PREFIX = "search:answer:v1:";
/** 24h(AI 信息时效口径;改版升版换前缀 v1 → v2 即可) */
export const ANSWER_CACHE_TTL_SECONDS = 86_400;

/** 归一:trim + 小写 + 空白折叠(「MCP 实战」与「mcp  实战 」同键) */
export function normalizeQueryKey(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export function answerCacheKey(q: string): string {
  return CACHE_PREFIX + createHash("sha1").update(normalizeQueryKey(q)).digest("hex");
}

export interface CachedAnswer {
  answer: string;
  followUps: string[];
  cites: AnswerCite[];
  total: number;
  noHits: boolean;
  /** 生成耗时(缓存回放沿用原值,前端「生成 X.Xs」口径一致) */
  durationMs: number;
}

export async function readAnswerCache(q: string): Promise<CachedAnswer | null> {
  const raw = await redis.get(answerCacheKey(q)).catch(() => null);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as CachedAnswer;
  } catch {
    return null;
  }
}

export async function writeAnswerCache(q: string, value: CachedAnswer): Promise<void> {
  await redis
    .set(answerCacheKey(q), JSON.stringify(value), "EX", ANSWER_CACHE_TTL_SECONDS)
    .catch(() => undefined);
}
