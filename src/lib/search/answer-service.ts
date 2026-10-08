/**
 * 答案流编排(K2 核心,arch/04 §3.4):绑定解析 → 日配额 → 缓存 → 三域检索
 * → 流式生成 → 哨兵切分收尾。业务降级一律 SSE unavailable 事件(不占 HTTP 状态);
 * 用量台账逐次落行(缓存命中计配额 tokens 0;failed 不占——countTodayRoleUsage
 * 只数 ok/degraded)。客户端中途断开:已发增量按 done 收尾(degraded,不写缓存)。
 */
import { AI_PURPOSE_SEARCH } from "@/lib/ai/constants";
import { chatStream } from "@/lib/ai/llm-client";
import { getRoleDailyMax, resolveAiModel } from "@/lib/ai/resolver";
import { recordAiUsage } from "@/lib/ai/usage-log";
import { countTodayRoleUsage } from "@/lib/ai/usage-queries";
import { formatCnDateTime } from "@/lib/datetime";
import { logger } from "@/lib/logger";

import { encodeAnswerEvent, type AnswerCite, type AnswerEvent } from "./answer-protocol";
import { readAnswerCache, writeAnswerCache, type CachedAnswer } from "./answer-cache";
import { splitSentinel, visiblePrefix } from "./answer-parse";
import {
  ANSWER_MAX_TOKENS,
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  buildCiteBlocks,
  citeKindOf,
  pickCitations,
} from "./answer-prompt";
import { CITATION_SNIPPET_MAX, loadCitationBodies, searchAll } from "./unified-search";

/** 终态降级帧流(无绑定/超配额:单帧 unavailable,不落 usage 行——无 LLM 调用) */
function unavailableStream(
  reason: Extract<AnswerEvent, { type: "unavailable" }>["reason"],
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(encodeAnswerEvent({ type: "unavailable", reason })),
      );
      controller.close();
    },
  });
}

export async function createAnswerStream(q: string): Promise<ReadableStream<Uint8Array>> {
  const startedAt = Date.now();
  const model = await resolveAiModel(AI_PURPOSE_SEARCH);
  if (!model) return unavailableStream("no_binding");
  const [used, dailyMax] = await Promise.all([
    countTodayRoleUsage(AI_PURPOSE_SEARCH),
    getRoleDailyMax(AI_PURPOSE_SEARCH),
  ]);
  if (used >= dailyMax) return unavailableStream("quota");

  const abort = new AbortController();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const push = (e: AnswerEvent): void => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(encodeAnswerEvent(e)));
        } catch {
          closed = true; // 客户端已断,enqueue 抛错即静默停发
        }
      };

      try {
        // 缓存命中:meta + 全量单 delta + done(沿用缓存 cites/耗时);计配额 tokens 0
        const cached = await readAnswerCache(q);
        if (cached) {
          await recordAiUsage({
            role: AI_PURPOSE_SEARCH,
            modelId: model.id,
            modelKey: model.modelId,
            tokensIn: 0,
            tokensOut: 0,
            durationMs: 0,
            status: "ok",
          });
          push(cachedMetaEvent(cached));
          push({ type: "delta", text: cached.answer });
          push({ type: "done", durationMs: cached.durationMs, followUps: cached.followUps });
          closed = true;
          controller.close();
          return;
        }

        const result = await searchAll(q);
        const generatedAt = formatCnDateTime(new Date());
        const hasHits = result.total > 0;
        const picks = hasHits ? pickCitations(result.groups) : [];
        const bodies =
          picks.length > 0 ? await loadCitationBodies(picks) : new Map<string, string>();
        const cites: AnswerCite[] = picks.map((p, i) => ({
          n: i + 1,
          kind: citeKindOf(p),
          title: p.title,
          href: p.href,
          snippet: (bodies.get(`${p.domain}:${p.id}`) ?? p.snippet).slice(0, CITATION_SNIPPET_MAX),
        }));
        push({
          type: "meta",
          total: result.total,
          noHits: !hasHits,
          cites,
          // 展示串直接给北京时区格式(全站时间口径红线,datetime.ts);
          // 缓存写入复用同一时刻,命中回放不把命中时刻当生成时刻
          generatedAt,
        });

        // 流式生成:哨兵与半截哨兵扣住不外泄,只发可见前缀增量
        let raw = "";
        let sent = 0;
        let broken = false;
        let tokensIn = 0;
        let tokensOut = 0;
        try {
          const { usage } = await chatStream(
            {
              protocol: model.protocol,
              baseUrl: model.baseUrl,
              modelId: model.modelId,
              apiKey: model.apiKey,
              system: buildAnswerSystemPrompt(!hasHits),
              user: buildAnswerUserPrompt(q, buildCiteBlocks(picks, bodies)),
              timeoutSec: model.timeoutSec,
              maxTokens: ANSWER_MAX_TOKENS,
              signal: abort.signal,
            },
            (d) => {
              raw += d;
              const vis = visiblePrefix(raw);
              if (vis.length > sent) {
                push({ type: "delta", text: vis.slice(sent) });
                sent = vis.length;
              }
            },
          );
          tokensIn = usage.tokensIn;
          tokensOut = usage.tokensOut;
        } catch (e) {
          broken = true;
          logger.warn({
            event: "search_answer.stream_failed",
            reason: e instanceof Error ? e.message : String(e),
          });
        }

        const { answer, followUps } = splitSentinel(raw);
        if (answer === "") {
          // 无可展示内容:已发增量 → done 收尾(半截答案总比空白好);零增量 → error
          if (sent > 0) {
            push({ type: "done", durationMs: Date.now() - startedAt, followUps: [] });
            await recordAiUsage({
              role: AI_PURPOSE_SEARCH,
              modelId: model.id,
              modelKey: model.modelId,
              durationMs: Date.now() - startedAt,
              status: "degraded",
            });
          } else {
            push({ type: "unavailable", reason: "error" });
            await recordAiUsage({
              role: AI_PURPOSE_SEARCH,
              modelId: model.id,
              modelKey: model.modelId,
              durationMs: Date.now() - startedAt,
              status: "failed",
            });
          }
          closed = true;
          controller.close();
          return;
        }

        const durationMs = Date.now() - startedAt;
        const degraded = model.source === "backup" || broken;
        push({ type: "done", durationMs, followUps });
        await recordAiUsage({
          role: AI_PURPOSE_SEARCH,
          modelId: model.id,
          modelKey: model.modelId,
          tokensIn,
          tokensOut,
          durationMs,
          status: degraded ? "degraded" : "ok",
        });
        // 只缓存成功生成(答案非空);断流半截答案不写,避免 24h 复用残缺内容
        if (!broken) {
          await writeAnswerCache(q, {
            answer,
            followUps,
            cites,
            total: result.total,
            noHits: !hasHits,
            durationMs,
            generatedAt,
          });
        }
        closed = true;
        controller.close();
      } catch (e) {
        logger.error({
          event: "search_answer.pipeline_failed",
          error: e instanceof Error ? e.message : String(e),
        });
        push({ type: "unavailable", reason: "error" });
        closed = true;
        try {
          controller.close();
        } catch {
          /* 已断开 */
        }
      }
    },
    cancel() {
      abort.abort(); // chatStream 经 signal 中止上游,已发增量由 broken 路径收尾
    },
  });
}

/** 缓存回放 meta 事件(cites/total/noHits/generatedAt 与生成时一致;
 * 修复前写入的存量缓存缺 generatedAt,24h 内回落命中时刻、北京格式) */
function cachedMetaEvent(c: CachedAnswer): AnswerEvent {
  return {
    type: "meta",
    total: c.total,
    noHits: c.noHits,
    cites: c.cites,
    generatedAt: c.generatedAt ?? formatCnDateTime(new Date()),
  };
}
