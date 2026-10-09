/**
 * 会话 run SSE 端点(K2.5 核心,arch/04 §3.3;K2.6 身份分流,M22 批④扩
 * 三路):SDK runs.stream 契约的自实现——POST /threads/{threadId}/runs/stream,
 * input 只收 human 消息。登录身份(admin/user):归属查会话行、会话累计
 * 50k 前置拒绝、标题回填;user 另走 Token 余额链路——run 前 hasTokenBalance
 * 预检(≤0 拒),run 后按实际用量 consumeTokens 实扣(流水 reason=consume,
 * 扣减失败只告警不反噬已完成的 run);admin 与游客不扣余额。游客:归属查
 * Redis 活跃键(过期 404 自愈)、3 问/日/游客 + 30 问/日/IP 双闸。共用
 * 工级护栏:IP 10 次/分;run 编排在 runAgentTurn。业务降级一律 SSE error
 * 帧,不占 HTTP 状态。SSE 头 no-store + x-accel-buffering:no。
 */
import { type NextRequest } from "next/server";
import { z } from "zod";

import { AGENT_MAX_TOKENS, recordAgentRun, runAgentTurn } from "@/lib/agent/run";
import { backfillSessionTitle } from "@/lib/agent/sessions";
import { tryConsumeAgentRunQuota, tryConsumeGuestAskQuota } from "@/lib/agent/quota";
import {
  isGuestThreadId,
  getGuestThreadOwner,
  refreshGuestThread,
} from "@/lib/agent/guest-threads";
import { resolveAgentIdentity } from "@/lib/agent/identity";
import { hasTokenBalance, consumeTokens } from "@/lib/users/token-balance";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/http/origin";
import { clientIp } from "@/lib/http/request";
import { apiEnvelope } from "@/lib/http/response";
import { logger } from "@/lib/logger";

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
  const identity = await resolveAgentIdentity(req);

  // 归属校验 + 护栏基线:admin 查行(50k 累计);游客查 Redis 键(fail-closed)
  let tokensTotal = 0;
  if (identity.kind === "guest") {
    if (!isGuestThreadId(threadId)) return apiEnvelope(404, "会话不存在");
    const owner = await getGuestThreadOwner(threadId);
    if (owner !== identity.key) return apiEnvelope(404, "会话已过期,请开启新会话");
  } else {
    const row = await prisma.searchAgentSession.findUnique({
      where: { id: threadId },
      select: { visitorId: true, tokensTotal: true },
    });
    if (!row || row.visitorId !== identity.key) return apiEnvelope(404, "会话不存在");
    tokensTotal = row.tokensTotal;
  }

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

  if (identity.kind !== "guest" && tokensTotal >= AGENT_MAX_TOKENS) {
    return apiEnvelope(429, "本会话用量已达上限,请新建会话继续");
  }
  if (identity.kind === "guest" && !(await tryConsumeGuestAskQuota(identity.key, clientIp(req)))) {
    return apiEnvelope(429, "今日游客提问次数已用完,明天再来吧");
  }
  // M22 user 余额预检(免费额度制:>0 放行,实扣在 run 后;穿仓下限=单轮护栏)
  if (identity.kind === "user" && !(await hasTokenBalance(identity.userId))) {
    return apiEnvelope(429, "本月 AI 额度已用完,将于下月 1 日自动重置");
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
          userId: identity.kind === "user" ? identity.userId : undefined,
        });
        // user 实扣(append-only 流水同事务;失败只告警——计费异常不反噬已完成的 run)
        if (identity.kind === "user") {
          try {
            await consumeTokens(identity.userId, outcome.tokensIn + outcome.tokensOut, threadId);
          } catch (e) {
            logger.warn({
              event: "token_wallet.consume_failed",
              threadId,
              userId: identity.userId.toString(),
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        if (identity.kind === "guest") {
          await refreshGuestThread(threadId); // 活跃滑动 TTL
        } else {
          await backfillSessionTitle(threadId, message);
        }
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
