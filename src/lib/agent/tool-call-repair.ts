/**
 * 悬空 tool_calls / 孤儿 ToolMessage 的模型调用前修复(SasanAgent 同款范式平移,
 * 2026-10-10 ask_user 可靠性收口)。
 *
 * 解决的 bug:消息历史出现「AIMessage 带 tool_calls 但其后没有对应 tool_call_id
 * 的 ToolMessage」时,OpenAI 兼容端点直接 400 "assistant message with 'tool calls'
 * must be followed by tool messages"(LangChain INVALID_TOOL_RESULTS)。
 *
 * 悬空的三条来源(都可真实发生,模型调用前统一兜底):
 * 1. 停止生成打断在工具节点中间:abort 在 super-step 边界生效,模型节点的
 *    AIMessage(tool_calls) 已落 checkpoint,工具节点执行中被中止 → ToolMessage 永不落;
 * 2. ask_user 挂起后用户弃答:历史上(中断卡水合修复前)刷新/切会话丢卡、
 *    composer 复活发新消息 → 新输入直接续图,悬空 tool_calls 留在 checkpoint;
 * 3. 存量脏会话:上述路径已在生产产生的 checkpoint,不修复则该会话永久 400。
 *
 * 修复规则(LangChain 官方 removeInvalidToolCalls 同思路,贴合自有消息形状):
 * - 正向(反向扫描实现):每条带 tool_calls 的 AIMessage 只保留「其后到下一条
 *   AI/Human 边界之前」被 ToolMessage 应答过的 tool_call;未应答的剥掉
 *   (tool_calls 剥空且无内容则整条丢弃——空壳 assistant 消息部分端点同样拒收);
 * - 反向:ToolMessage 的 tool_call_id 找不到任何保留 AIMessage 的 tool_calls →
 *   孤儿,一并剔除(孤儿扫描无条件执行:本函数剥除连带制造 + 存量脏数据)。
 *
 * **临时改写,不落任何持久化**:只改 wrapModelCall 的 request 副本,checkpoint /
 * 前端回读的历史原样保留——用户刷新仍能看到当时的消息;只是模型上下文不再携带
 * 非法序列。无脏数据时同一引用透传(零开销快路径)。
 */
import { AIMessage, ToolMessage, createMiddleware } from "langchain";

import { logger } from "../logger";

import type { AgentMiddleware, BaseMessage } from "langchain";

/** ToolMessage.tool_call_id 窄化读取(null 视为无 id,按孤儿处理)。 */
function toolCallIdOf(msg: BaseMessage): string | null {
  if (!ToolMessage.isInstance(msg)) return null;
  return typeof msg.tool_call_id === "string" ? msg.tool_call_id : null;
}

/** AIMessage.tool_calls 窄化读取(非数组视为无)。 */
function toolCallsOf(msg: BaseMessage): Array<{ id?: string; name?: string; args?: unknown }> {
  if (!AIMessage.isInstance(msg)) return [];
  const calls = (msg as AIMessage).tool_calls;
  return Array.isArray(calls) ? calls : [];
}

/** 消息边界:OpenAI 语义里 tool 应答必须紧跟 tool_calls 消息、先于下一对话轮。 */
function isTurnBoundary(msg: BaseMessage): boolean {
  return AIMessage.isInstance(msg) || msg.getType() === "human";
}

/**
 * 消息序列 → 剔除悬空 tool_calls / 孤儿 ToolMessage 后的序列(纯函数)。
 * 输入原样引用透传(无脏数据时返回同一数组引用,调用方据此走零开销快路径)。
 */
export function repairToolCallMessages(messages: BaseMessage[]): {
  messages: BaseMessage[];
  droppedToolCalls: number;
  droppedToolMessages: number;
} {
  // 反向扫描维护 seenAhead:位于当前消息之后、且未被 AI/Human 边界隔开的
  // ToolMessage 应答集合。AIMessage 的 tool_call 被应答 = id ∈ seenAhead。
  const seenAhead = new Set<string>();
  const pass1: BaseMessage[] = [];
  let droppedToolCalls = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const toolCallId = toolCallIdOf(msg);
    if (toolCallId !== null) {
      pass1.push(msg);
      seenAhead.add(toolCallId);
      continue;
    }
    const calls = toolCallsOf(msg);
    if (calls.length === 0) {
      pass1.push(msg);
      if (isTurnBoundary(msg)) seenAhead.clear();
      continue;
    }
    // AIMessage(tool_calls):此刻 seenAhead 即「紧随其后一段」的应答集合。
    const kept = calls.filter((c) => typeof c.id === "string" && seenAhead.has(c.id));
    if (kept.length === calls.length) {
      pass1.push(msg);
    } else {
      droppedToolCalls += calls.length - kept.length;
      const content = msg.content;
      const hasContent =
        (typeof content === "string" && content !== "") ||
        (Array.isArray(content) && content.length > 0);
      // 剥空且无内容 → 空壳整条丢弃;否则保留文本(reasoning 块)重建。
      if (kept.length > 0 || hasContent) {
        pass1.push(
          new AIMessage({
            content: msg.content,
            ...(kept.length > 0
              ? {
                  tool_calls: kept.map((c) => ({
                    id: c.id!,
                    name: c.name ?? "",
                    args: (c as { args?: unknown }).args ?? {},
                  })),
                }
              : {}),
            id: msg.id,
            name: msg.name,
            additional_kwargs: msg.additional_kwargs,
            response_metadata: msg.response_metadata,
          }),
        );
      }
    }
    // 消费完毕,本消息之后的应答不再属于更早的 tool_calls。
    seenAhead.clear();
  }
  pass1.reverse();

  // 第二遍:孤儿 ToolMessage(应答的 tool_call_id 不在任何保留 AIMessage 的
  // tool_calls 里)。两类来源:本函数正向剥除连带制造 + 存量脏数据——都会
  // 400,故无条件扫描剔除。
  const validIds = new Set<string>();
  for (const msg of pass1) {
    for (const c of toolCallsOf(msg)) {
      if (typeof c.id === "string") validIds.add(c.id);
    }
  }
  let droppedToolMessages = 0;
  const final = pass1.filter((msg) => {
    const id = toolCallIdOf(msg);
    if (id === null) return true;
    if (validIds.has(id)) return true;
    droppedToolMessages++;
    return false;
  });

  // 全清 → 原样引用透传(两遍扫描已证无脏数据,零开销快路径契约)。
  if (droppedToolCalls === 0 && droppedToolMessages === 0) {
    return { messages, droppedToolCalls: 0, droppedToolMessages: 0 };
  }
  return { messages: final, droppedToolCalls, droppedToolMessages };
}

/**
 * 悬空 tool_calls 修复中间件:wrapModelCall 请求副本改写,不落任何持久化。
 * 无脏数据时 request 原样透传(同一引用,零开销)。
 */
export const toolCallRepairMiddleware: AgentMiddleware = createMiddleware({
  name: "tool_call_repair",
  wrapModelCall: async (request, handler) => {
    const repaired = repairToolCallMessages(request.messages);
    if (repaired.droppedToolCalls === 0 && repaired.droppedToolMessages === 0) {
      return handler(request);
    }
    logger.warn({
      event: "agent.tool_calls_repaired",
      droppedToolCalls: repaired.droppedToolCalls,
      droppedToolMessages: repaired.droppedToolMessages,
    });
    return handler({ ...request, messages: repaired.messages });
  },
});
