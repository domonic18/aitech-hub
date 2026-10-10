/**
 * ask_user 单飞守卫(SasanAgent ask_question 同款范式平移,2026-10-10)。
 *
 * 问题:模型可能在一条 AIMessage 里并行发起多个 ask_user 调用。LangGraph 对
 * 含 interrupt 的并行工具批次在 resume 时整批重执行、resume 值按重执行顺序
 * 投递——两个 interrupt 会造成答案错位(第一个答案喂给第二个问题)。
 *
 * 守卫基于 checkpoint 里的稳定信息:触发本批工具的 AIMessage 的 tool_calls
 * (顺序持久化,重执行必然一致),只放行按序第一个 ask_user,其余直接返回
 * 「请合并」提示(模型可自纠)。非 ask_user 工具原样放行;找不到触发消息
 * (state 异常/消息被压缩截断)时 fail-closed 拦截——放行会让非首个 ask_user
 * 在 resume 重执行时进入 interrupt,答案错位比报错更危险。
 */
import { AIMessage, ToolMessage, createMiddleware } from "langchain";

import { logger } from "../logger";

import { AGENT_ASK_USER_TOOL } from "./hitl";

import type { BaseMessage } from "@langchain/core/messages";
import type { AgentMiddleware } from "langchain";

/** 并行第二个 ask_user 的拦截文案(模型能据此合并重试)。 */
const MERGE_HINT = "本条消息中已有进行中的提问,请将相关问题合并为一次 ask_user 调用。";

/** fail-closed 拦截文案(state 异常):与正常拦截分开,模型能区分根因自纠。 */
const GUARD_DEGRADED = "系统状态异常,本次提问未能发起。请稍后重试;若持续失败请勿反复调用。";

/** 无 id 调用的哨兵(必不与任何 tool_call id 相等 → 判定落 degraded)。 */
const GUARD_NO_ID = "__no_tool_call_id__";

type FlightVerdict = "pass" | "merge" | "degraded";

/** 触发消息的 tool_calls 最小读取形状(防御式窄化,异常形状按无处理)。 */
function toolCallsOf(msg: unknown): Array<{ id?: string; name?: string }> {
  const calls = (msg as { tool_calls?: unknown } | null)?.tool_calls;
  return Array.isArray(calls) ? (calls as Array<{ id?: string; name?: string }>) : [];
}

/**
 * 判定当前 ask_user 是否为本批按序第一个(纯函数,供中间件与单测共用)。
 * messages 反向遍历:触发的 AIMessage 是最新那条,避免正向命中历史中同 id
 * 消息(tool_call id 复用/消息回放)。返回:
 * - "pass":当前调用是首个 ask_user;
 * - "merge":本消息存在更早的 ask_user → 拦截合并;
 * - "degraded":找不到触发消息 → fail-closed 拦截。
 */
export function judgeAskUserFlight(messages: BaseMessage[], toolCallId: string): FlightVerdict {
  for (let i = messages.length - 1; i >= 0; i--) {
    const calls = toolCallsOf(messages[i]);
    if (calls.length === 0) continue;
    if (!calls.some((c) => c.id === toolCallId)) continue;
    const firstAsk = calls.find((c) => c.name === AGENT_ASK_USER_TOOL);
    if (firstAsk && firstAsk.id !== toolCallId) return "merge";
    return "pass";
  }
  return "degraded";
}

export const askUserGuardMiddleware: AgentMiddleware = createMiddleware({
  name: "ask_user_guard",
  wrapToolCall: async (request, handler) => {
    if (request.toolCall.name !== AGENT_ASK_USER_TOOL) return handler(request);
    // 无 id 无法锚定触发消息:同 fail-closed(放行会在 resume 重执行时进 interrupt)
    const verdict = judgeAskUserFlight(request.state.messages, request.toolCall.id ?? GUARD_NO_ID);
    if (verdict === "pass") return handler(request);
    if (verdict === "merge") {
      logger.info({ event: "agent.ask_user_merge_blocked" });
    } else {
      logger.error({ event: "agent.ask_user_guard_miss" });
    }
    return new ToolMessage({
      tool_call_id: request.toolCall.id ?? "",
      name: AGENT_ASK_USER_TOOL,
      content: verdict === "merge" ? MERGE_HINT : GUARD_DEGRADED,
    });
  },
});
