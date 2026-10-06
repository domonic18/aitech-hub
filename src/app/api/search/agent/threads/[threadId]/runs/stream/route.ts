/**
 * 会话 run SSE 端点(K2.5 核心,arch/04 §3.3):SDK runs.stream 契约的
 * 自实现——POST /threads/{threadId}/runs/stream,input 只收 human 消息。
 * 流级护栏:归属校验 404、会话累计 50k 前置拒绝、IP 10 次/分;run 编排在
 * runAgentTurn(帧序列 metadata→messages|updates*→end)。业务降级一律
 * SSE error 帧(前端挂到末条 AI 消息 incomplete/error),不占 HTTP 状态。
 * SSE 头 no-store + x-accel-buffering:no(nginx ^~ /api/search/ 已关缓冲)。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { AGENT_MAX_TOKENS, recordAgentRun, runAgentTurn } from "@/lib/agent/run";
import { backfillSessionTitle } from "@/lib/agent/sessions";
import { tryConsumeAgentRunQuota } from "@/lib/agent/quota";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";
import { resolveVisitorId } from "@/lib/agent/visitor";

export const dynamic = "force-dynamic";

/** input.messages 只收单条 human 文本(K2.5 无附件/无多模态面) */
const bodySchema = z.object({
  input: z.object({
    messages: z
      .array(
        z.object({
          type: z.literal("human"),
          content: z.union([
            z.string().min(1).max(2000),
            z
              .array(z.object({ type: z.literal("text"), text: z.string().min(1).max(2000) }))
              .min(1)
              .max(4),
          ]),
        }),
      )
      .min(1)
      .max(1),
  }),
});

function extractText(content: string | { text: string }[]): string {
  if (typeof content === "string") return content.trim();
  return content
    .map((c) => c.text)
    .join("\n")
    .trim();
}

function sseHeaders(): HeadersInit {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  if (!isSameOrigin(req)) return apiEnvelope(403, "cross-origin forbidden");
  const { threadId } = await params;
  const visitor = resolveVisitorId(req);

  const row = await prisma.searchAgentSession.findUnique({
    where: { id: threadId },
    select: { visitorId: true, tokensTotal: true },
  });
  if (!row || row.visitorId !== visitor.id) return apiEnvelope(404, "会话不存在");

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return apiEnvelope(400, "invalid json");
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiEnvelope(400, `invalid body: ${parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  const message = extractText(parsed.data.input.messages[0].content);
  if (message === "") return apiEnvelope(400, "消息不能为空");

  if (row.tokensTotal >= AGENT_MAX_TOKENS) {
    return apiEnvelope(429, "本会话用量已达上限,请新建会话继续");
  }
  if (!(await tryConsumeAgentRunQuota(clientIp(req)))) {
    return apiEnvelope(429, "操作过于频繁,请稍后再试");
  }

  const abort = new AbortController();
  const startedAt = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const push = (frame: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          closed = true; // 客户端已断
        }
      };
      const onAbort = (): void => {
        closed = true;
      };
      abort.signal.addEventListener("abort", onAbort);

      try {
        const outcome = await runAgentTurn({
          threadId,
          message,
          signal: abort.signal,
          onFrame: push,
        });
        await recordAgentRun({
          sessionId: threadId,
          durationMs: Date.now() - startedAt,
          outcome,
        });
        await backfillSessionTitle(threadId, message);
        if (outcome.truncatedReason !== null) {
          // 护栏收束:error 帧人话(前端挂末条 AI 消息 incomplete/error)
          push(`event: error\ndata: ${JSON.stringify({ message: outcome.truncatedReason })}\n\n`);
        }
      } catch (e) {
        logger.warn({
          event: "agent.run_failed",
          threadId,
          error: e instanceof Error ? e.message : String(e),
        });
        push(`event: error\ndata: ${JSON.stringify({ message: "处理中断,请重试" })}\n\n`);
      } finally {
        abort.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          /* 已断开 */
        }
      }
    },
    cancel() {
      abort.abort(); // 客户端断开中止 agent;已产 usage 由 runAgentTurn 出口照记
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
