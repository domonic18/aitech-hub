/**
 * 会话 run 流编排(K2.5 核心):deepagents 多通道流(streamMode messages/updates)
 * → wire SSE 帧。护栏落地(arch/04 §3.4):单轮工具调用/tokens/recursion 三闸
 * (2026-10-17 起额度后台「站点设置」可调,site_config kv——值经路由侧
 * getAgentLimitsAll 读档后传入,本模块不再硬编码;默认与派生见
 * config/agent-limits)。台账逐 run 落 ai_usage_log(role=search_agent);
 * 会话行 touch+tokens 累计;客户端断开经 AbortSignal 中止 agent,已产 usage 照记。
 */
import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";

import { recordAiUsage, AI_USAGE_ROLE_SEARCH_AGENT } from "../ai/usage-log";
import { logger } from "../logger";

import type { ResolvedAiModel } from "../ai/resolver";

import { getAgentGraph } from "./agent";
import { GUEST_THREAD_PREFIX } from "./guest-threads";
import type { AgentIdentity } from "./identity";
import type { AgentRunContext } from "./run-context";
import { withAgentContext } from "./run-context";
import { touchSessionAfterRun } from "./sessions";
import { encodeWireEvent, encodeWireMessage } from "./wire";

// todos 提取在零依赖模块(前端计划条共用,客户端 bundle 不经此文件拉 deepagents)
export { extractTodos, type AgentTodo } from "./todos";

/** 单轮护栏三闸(调用方从 config/agent-limits 读档构造;recursion 为派生兜底) */
export interface AgentRunLimits {
  toolCalls: number;
  tokens: number;
  recursion: number;
}

/** 从 updates 载荷收集已完成工具调用 id(tool 消息的 tool_call_id,与 chunk 侧同集去重) */
function collectToolCallIds(updates: unknown, into: Set<string>): void {
  if (typeof updates !== "object" || updates === null) return;
  for (const value of Object.values(updates as Record<string, unknown>)) {
    const msgs = (value as { messages?: unknown }).messages;
    if (!Array.isArray(msgs)) continue;
    for (const m of msgs) {
      const id = (m as { tool_call_id?: string }).tool_call_id;
      if (typeof id === "string" && id !== "") into.add(id);
    }
  }
}

export interface AgentRunParams {
  threadId: string;
  /** 新提问文本(resume 分支为 null,两者必居其一,路由层把关) */
  message: string | null;
  /** HITL 恢复值(ask_user 提问卡回答;经 Command({resume}) 灌回中断的工具) */
  resume?: unknown;
  /** 页面上下文(M27 批⑧-b,路由层已按身份 sanitize):仅新提问注入 human
   * 消息前缀;resume 分支不注入——中断上下文已持久在 checkpoint 历史里 */
  context?: AgentRunContext | null;
  /** 身份档(决定工具面与护栏档——admin 图才有专题生产四件工具) */
  identityKind: AgentIdentity["kind"];
  /** 单轮护栏三闸(路由侧经 config/agent-limits 读档:额度可后台调整) */
  limits: AgentRunLimits;
  signal: AbortSignal;
  /** 流帧出口(路由侧只管 encode 后下发) */
  onFrame: (frame: string) => void;
}

/** 单次 run 的执行结果(路由层落库/记台账) */
export interface AgentRunOutcome {
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  /** 超限收束时的人话说明(正常为 null) */
  truncatedReason: string | null;
  /** 本次命中的绑定(台账 modelId/modelKey 直取,免二次解析) */
  resolved: ResolvedAiModel | null;
}

interface UsageMeta {
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * 执行一次会话 run 并推送帧流。错误面:抛出即路由层补 error 帧(调用方负责
 * 收尾);帧序列 metadata → (messages|updates)* → end。
 */
export async function runAgentTurn(params: AgentRunParams): Promise<AgentRunOutcome> {
  const { threadId, message, resume, identityKind, limits, signal, onFrame, context } = params;
  const { graph, resolved } = await getAgentGraph(identityKind);
  const runId = crypto.randomUUID();

  const outcome: AgentRunOutcome = {
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 0,
    truncatedReason: null,
    resolved,
  };
  const seenToolCallIds = new Set<string>();

  onFrame(encodeWireEvent("metadata", { run_id: runId, thread_id: threadId }));

  // resume 分支(HITL):Command 作图输入,中断的 ask_user 工具重放并拿到回
  // 答继续;正常分支注入单条 human 消息(有页面上下文时加 [页面上下文] 前缀,
  // ai-invest _with_page_context 同款)。streamMode/护栏两分支一致。
  const input =
    resume !== undefined
      ? new Command({ resume })
      : { messages: [new HumanMessage(withAgentContext(message ?? "", context ?? null))] };
  const stream = await graph.stream(input, {
    configurable: { thread_id: threadId },
    streamMode: ["messages", "updates"] as ["messages", "updates"],
    recursionLimit: limits.recursion,
    signal,
  });

  for await (const entry of stream) {
    if (signal.aborted) break;
    const [mode, payload] = entry as [string, unknown];
    if (mode === "messages") {
      const [chunk] = (payload ?? []) as [unknown, unknown];
      const usage = (chunk as { usage_metadata?: UsageMeta } | null)?.usage_metadata;
      if (usage) {
        outcome.tokensIn += usage.input_tokens ?? 0;
        outcome.tokensOut += usage.output_tokens ?? 0;
      }
      for (const tc of (chunk as { tool_call_chunks?: { id?: string }[] } | null)
        ?.tool_call_chunks ?? []) {
        if (tc.id) seenToolCallIds.add(tc.id);
      }
      outcome.toolCalls = seenToolCallIds.size;
      // 超身份档 tokens / 工具调用上限:主动收束(护栏非计费;检在发前,超限帧不外泄)
      if (outcome.tokensIn + outcome.tokensOut > limits.tokens) {
        outcome.truncatedReason = "本会话用量已达上限,请新建会话继续";
        break;
      }
      if (outcome.toolCalls > limits.toolCalls) {
        outcome.truncatedReason = "本条回复的工具调用已达上限,已主动收束";
        break;
      }
      onFrame(encodeWireMessage(chunk as Parameters<typeof encodeWireMessage>[0]));
    } else if (mode === "updates") {
      collectToolCallIds(payload, seenToolCallIds);
      outcome.toolCalls = seenToolCallIds.size;
      onFrame(encodeWireEvent("updates", payload));
    }
  }

  if (!signal.aborted) onFrame(encodeWireEvent("end", {})); // 客户端已断,收尾帧无意义
  return outcome;
}

/** run 后台账与会话行更新(失败只告警,不反噬——usage-log 同款纪律);
 * 游客线程(g_ 前缀,无会话行)只落台账不 touch */
export async function recordAgentRun(params: {
  sessionId: string;
  durationMs: number;
  outcome: AgentRunOutcome;
  /** 登录用户锚(M22 透传 ai_usage_log.user_id;游客/admin 之外的站点级调用缺省) */
  userId?: bigint;
}): Promise<void> {
  const { sessionId, durationMs, outcome } = params;
  await recordAiUsage({
    role: AI_USAGE_ROLE_SEARCH_AGENT,
    modelId: outcome.resolved?.id,
    modelKey: outcome.resolved?.modelId ?? "unknown",
    tokensIn: outcome.tokensIn,
    tokensOut: outcome.tokensOut,
    durationMs,
    status: outcome.truncatedReason ? "degraded" : "ok",
    sessionId,
    userId: params.userId,
  });
  if (sessionId.startsWith(GUEST_THREAD_PREFIX)) return;
  try {
    await touchSessionAfterRun(sessionId, outcome.tokensIn + outcome.tokensOut);
  } catch (e) {
    logger.warn({
      event: "agent.session_touch_failed",
      sessionId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
