/**
 * interrupt 类工具单飞守卫(SasanAgent ask_question 同款范式平移,2026-10-10;
 * M27 批⑧-c 白名单扩 propose_edits,语义改名 interrupt-guard 口径)。
 *
 * 问题:模型可能在一条 AIMessage 里并行发起多个 interrupt 类工具调用
 * (ask_user 提问 / propose_edits 提案 / generate_post_cover 封面确认)。
 * LangGraph 对含 interrupt 的并行工具批次在 resume 时整批重执行、resume 值按
 * 重执行顺序投递——两个 interrupt 会造成答案/评审结果错位(第一个回答喂给
 * 第二个问题)。封面 auto 档(auto_adopt:true)工具体不产生 interrupt,
 * 中间件短路放行不占单飞名额(2026-10-20)。
 *
 * 守卫基于 checkpoint 里的稳定信息:触发本批工具的 AIMessage 的 tool_calls
 * (顺序持久化,重执行必然一致),只放行按序第一个 interrupt 类调用,其余直接
 * 返回「请合并」提示(模型可自纠)。非 interrupt 类工具原样放行;找不到触发
 * 消息(state 异常/消息被压缩截断)时 fail-closed 拦截——放行会让非首个
 * interrupt 在 resume 重执行时进入 interrupt,错位比报错更危险。
 */
import { ToolMessage, createMiddleware } from "langchain";

import { logger } from "../logger";

import { GENERATE_POST_COVER_TOOL } from "./cover-tool";
import { AGENT_PROPOSE_EDITS_TOOL } from "./edit-proposal";
import { AGENT_ASK_USER_TOOL } from "./hitl";

import type { BaseMessage } from "@langchain/core/messages";
import type { AgentMiddleware } from "langchain";

/**
 * interrupt 类工具面(并行触发会 resume 错位,单飞放行按序第一个)。封面收
 * 真工具名 generate_post_cover——此前误收候选工具 generate_cover_candidates
 * (topic 域非 interrupt 工具),真封面工具反而不受单飞保护(2026-10-20 修正)
 */
const INTERRUPT_TOOLS = new Set<string>([
  AGENT_ASK_USER_TOOL,
  AGENT_PROPOSE_EDITS_TOOL,
  GENERATE_POST_COVER_TOOL,
]);

/** 并行第二个 interrupt 调用的拦截文案(模型能据此合并重试)。 */
const MERGE_HINT =
  "本条消息中已有进行中的交互(提问或提案),请将其完成后再发起新的,或将多个诉求合并为一次调用。";

/** fail-closed 拦截文案(state 异常):与正常拦截分开,模型能区分根因自纠。 */
const GUARD_DEGRADED = "系统状态异常,本次调用未能发起。请稍后重试;若持续失败请勿反复调用。";

/** 无 id 调用的哨兵(必不与任何 tool_call id 相等 → 判定落 degraded)。 */
const GUARD_NO_ID = "__no_tool_call_id__";

type FlightVerdict = "pass" | "merge" | "degraded";

/** 封面 auto 档调用判定(args.auto_adopt === true,2026-10-20):工具体不进
 * interrupt、候选直接采纳返回——无挂起即无 resume 重执行错位,不占单飞名额 */
function isAutoAdoptCall(args: unknown): boolean {
  return (
    typeof args === "object" &&
    args !== null &&
    (args as { auto_adopt?: unknown }).auto_adopt === true
  );
}

/** 触发消息的 tool_calls 最小读取形状(防御式窄化,异常形状按无处理)。 */
function toolCallsOf(msg: unknown): Array<{ id?: string; name?: string }> {
  const calls = (msg as { tool_calls?: unknown } | null)?.tool_calls;
  return Array.isArray(calls) ? (calls as Array<{ id?: string; name?: string }>) : [];
}

/**
 * 判定当前 interrupt 类调用是否为本批按序第一个(纯函数,供中间件与单测
 * 共用)。messages 反向遍历:触发的 AIMessage 是最新那条,避免正向命中历史中
 * 同 id 消息(tool_call id 复用/消息回放)。返回:
 * - "pass":当前调用是首个 interrupt 类工具;
 * - "merge":本消息存在更早的 interrupt 类调用 → 拦截合并;
 * - "degraded":找不到触发消息 → fail-closed 拦截。
 */
export function judgeInterruptFlight(messages: BaseMessage[], toolCallId: string): FlightVerdict {
  for (let i = messages.length - 1; i >= 0; i--) {
    const calls = toolCallsOf(messages[i]);
    if (calls.length === 0) continue;
    if (!calls.some((c) => c.id === toolCallId)) continue;
    const first = calls.find((c) => c.name !== undefined && INTERRUPT_TOOLS.has(c.name));
    if (first && first.id !== toolCallId) return "merge";
    return "pass";
  }
  return "degraded";
}

export const interruptGuardMiddleware: AgentMiddleware = createMiddleware({
  name: "interrupt_guard",
  wrapToolCall: async (request, handler) => {
    if (!INTERRUPT_TOOLS.has(request.toolCall.name)) return handler(request);
    // 封面 auto 档短路(仅 generate_post_cover 的 schema 接受 auto_adopt)
    if (
      request.toolCall.name === GENERATE_POST_COVER_TOOL &&
      isAutoAdoptCall(request.toolCall.args)
    ) {
      return handler(request);
    }
    // 无 id 无法锚定触发消息:同 fail-closed(放行会在 resume 重执行时进 interrupt)
    const verdict = judgeInterruptFlight(
      request.state.messages,
      request.toolCall.id ?? GUARD_NO_ID,
    );
    if (verdict === "pass") return handler(request);
    if (verdict === "merge") {
      logger.info({ event: "agent.interrupt_merge_blocked", tool: request.toolCall.name });
    } else {
      logger.error({ event: "agent.interrupt_guard_miss", tool: request.toolCall.name });
    }
    return new ToolMessage({
      tool_call_id: request.toolCall.id ?? "",
      name: request.toolCall.name,
      content: verdict === "merge" ? MERGE_HINT : GUARD_DEGRADED,
    });
  },
});
