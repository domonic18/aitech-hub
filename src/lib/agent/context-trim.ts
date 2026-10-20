/**
 * 模型调用前的上下文瘦身(2026-10-20 富 HTML 改造):每轮把完整历史重发给
 * 模型,token 近似平方增长。两条规则,均在 wrapModelCall 的请求副本上生效,
 * 不落任何持久化(checkpoint 与前端回读保持原样):
 *
 * 1. 已渲染的 render_card 调用,args.html 替换为占位文本(保留最近 2 次不动)。
 *    HTML 渲染后对后续轮次零信息价值,却是最大膨胀源(单张自由 HTML 可达
 *    30k 字符);preset/data/width/maxHeight 保留(模型仍需知道这张卡是什么)。
 *    **最近 2 次不剥**:实测(Kimi/MiniMax 同现)模型会回读自己上一轮的 tool_call
 *    参数,看到占位文本即误判「我刚才传的是占位符、写漏了 HTML」,于是重渲——
 *    而重渲又被剥成占位,形成死循环(一轮 20+ 次 render_card)。留最近两次既
 *    破环,又让更早的卡仍能被压缩。
 * 2. 估算上下文 > maxChars 时:较早的 get_topic_brief / get_skill / list_skills
 *    工具结果替换为占位文本,每种保留最近一次(首批素材/指南仍需可查)。
 *
 * 永不动:write_article(自审要用)、save_topic_draft、render_card 结果(返回
 * url 要嵌正文)、human 消息、system prompt(不在 messages 里)。
 * 不用 langchain 的 contextEditingMiddleware/ClearToolUsesEdit:它无差别清旧
 * 工具结果,draft_md 与卡片 url 会一起被干掉。
 *
 * 零拷贝快路径:无任何改动时返回原数组引用,调用方据此原样透传。
 */
import { AIMessage, ToolMessage, createMiddleware } from "langchain";

import { logger } from "../logger";

import type { AgentMiddleware, BaseMessage } from "langchain";

/** 超过此估算字符数才做规则 2(规则 1 无条件执行) */
export const CONTEXT_TRIM_THRESHOLD_CHARS = 150_000;

/** 保留最近几次 render_card 的 args.html 原样(破「回读自己参数 → 误判重渲」死循环) */
export const KEEP_RECENT_RENDER_ARGS = 2;

export const RENDER_CARD_HTML_PLACEHOLDER =
  "[系统压缩上下文:此处原有 HTML 已渲染为图片,url 见对应工具结果;不是模型输入错误,无需重新渲染]";
export const OLD_TOOL_RESULT_PLACEHOLDER = "[较早的工具结果已精简;如仍需细节,请重新调用该工具]";

/** 规则 2 的瘦身对象(一次性参考资料,重取成本低) */
const TRIMMABLE_TOOL_NAMES = new Set(["get_topic_brief", "get_skill", "list_skills"]);

interface ChatCall {
  id?: string;
  name?: string;
  args?: unknown;
}

export interface TrimStats {
  /** args.html 被替换的 render_card 调用数 */
  strippedHtmlArgs: number;
  /** 被占位文本替换的旧工具结果数 */
  shortenedResults: number;
  charsBefore: number;
  charsAfter: number;
}

export interface TrimResult {
  /** 无改动时与原数组同一引用 */
  messages: BaseMessage[];
  stats: TrimStats;
}

function toolCallsOf(msg: BaseMessage): ChatCall[] {
  if (!AIMessage.isInstance(msg)) return [];
  const calls = (msg as AIMessage).tool_calls;
  return Array.isArray(calls) ? (calls as ChatCall[]) : [];
}

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const block of content) {
      const b = block as { text?: unknown };
      n += typeof b?.text === "string" ? b.text.length : JSON.stringify(block ?? "").length;
    }
    return n;
  }
  return content === undefined || content === null ? 0 : JSON.stringify(content).length;
}

/** 估算单条消息的字符量:文本内容 + 工具调用参数(自由 HTML 卡最大的一块) */
function messageChars(msg: BaseMessage): number {
  let n = contentChars(msg.content);
  if (AIMessage.isInstance(msg)) {
    for (const c of toolCallsOf(msg)) n += JSON.stringify(c.args ?? {}).length;
  }
  return n;
}

function totalChars(messages: BaseMessage[]): number {
  let n = 0;
  for (const msg of messages) n += messageChars(msg);
  return n;
}

function rebuildAi(msg: AIMessage, calls: ChatCall[]): AIMessage {
  return new AIMessage({
    content: msg.content,
    tool_calls: calls.map((c) => ({
      id: c.id ?? "",
      name: c.name ?? "",
      args: (c.args ?? {}) as Record<string, unknown>,
    })),
    id: msg.id,
    name: msg.name,
    additional_kwargs: msg.additional_kwargs,
    response_metadata: msg.response_metadata,
  });
}

function rebuildToolResult(msg: ToolMessage, content: string): ToolMessage {
  return new ToolMessage({
    content,
    tool_call_id: msg.tool_call_id,
    id: msg.id,
    ...(typeof msg.name === "string" ? { name: msg.name } : {}),
    additional_kwargs: msg.additional_kwargs,
    response_metadata: msg.response_metadata,
    ...(msg.artifact !== undefined ? { artifact: msg.artifact } : {}),
  });
}

/**
 * 纯函数:按两条规则返回瘦身后的消息序列。无改动时返回同一数组引用。
 */
export function trimContextMessages(
  messages: BaseMessage[],
  opts: { maxChars?: number } = {},
): TrimResult {
  const maxChars = opts.maxChars ?? CONTEXT_TRIM_THRESHOLD_CHARS;
  const charsBefore = totalChars(messages);
  let strippedHtmlArgs = 0;
  let shortenedResults = 0;

  // tool_call_id → 调用名(来自 AIMessage);同时记录被应答的 id
  const nameById = new Map<string, string>();
  for (const msg of messages) {
    for (const c of toolCallsOf(msg)) {
      if (typeof c.id === "string" && typeof c.name === "string") nameById.set(c.id, c.name);
    }
  }
  const answeredIds = new Set<string>();
  for (const msg of messages) {
    if (ToolMessage.isInstance(msg) && typeof msg.tool_call_id === "string") {
      answeredIds.add(msg.tool_call_id);
    }
  }

  // 规则 1:AIMessage 里已渲染的 render_card 调用,剥掉 args.html(最近 N 次除外)
  const strippable = (c: ChatCall): boolean => {
    const args = (c.args ?? {}) as Record<string, unknown>;
    return (
      c.name === "render_card" &&
      typeof c.id === "string" &&
      answeredIds.has(c.id) &&
      typeof args.html === "string" &&
      args.html !== ""
    );
  };
  let htmlCallsTotal = 0;
  for (const msg of messages) {
    for (const c of toolCallsOf(msg)) if (strippable(c)) htmlCallsTotal += 1;
  }
  const stripUntil = htmlCallsTotal - KEEP_RECENT_RENDER_ARGS; // 只剥前 stripUntil 次
  let htmlCallsSeen = 0;

  let pass1: BaseMessage[] = messages;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (!AIMessage.isInstance(msg)) continue;
    const calls = toolCallsOf(msg);
    if (calls.length === 0) continue;
    let replaced = 0;
    const next = calls.map((c) => {
      if (strippable(c)) {
        htmlCallsSeen += 1;
        if (htmlCallsSeen > stripUntil) return c; // 最近 N 次原样保留
        replaced += 1;
        const args = (c.args ?? {}) as Record<string, unknown>;
        return { ...c, args: { ...args, html: RENDER_CARD_HTML_PLACEHOLDER } };
      }
      return c;
    });
    if (replaced === 0) continue;
    strippedHtmlArgs += replaced;
    if (pass1 === messages) pass1 = [...messages];
    pass1[i] = rebuildAi(msg, next);
  }

  // 规则 2:仅当估算超阈值,精简较早的可重取工具结果(每种留最近一次)
  const afterRule1 = totalChars(pass1);
  if (afterRule1 > maxChars) {
    const indicesByName = new Map<string, number[]>();
    for (let i = 0; i < pass1.length; i++) {
      const msg = pass1[i]!;
      if (!ToolMessage.isInstance(msg) || typeof msg.tool_call_id !== "string") continue;
      const name = nameById.get(msg.tool_call_id);
      if (!name || !TRIMMABLE_TOOL_NAMES.has(name)) continue;
      const list = indicesByName.get(name) ?? [];
      list.push(i);
      indicesByName.set(name, list);
    }
    const toShorten = new Set<number>();
    for (const list of indicesByName.values()) {
      for (const idx of list.slice(0, -1)) toShorten.add(idx); // 保留最后一条
    }
    if (toShorten.size > 0) {
      if (pass1 === messages) pass1 = [...messages];
      for (const idx of toShorten) {
        const msg = pass1[idx]!;
        if (!ToolMessage.isInstance(msg)) continue;
        pass1[idx] = rebuildToolResult(msg, OLD_TOOL_RESULT_PLACEHOLDER);
        shortenedResults += 1;
      }
    }
  }

  const charsAfter = pass1 === messages ? charsBefore : totalChars(pass1);
  return {
    messages: pass1,
    stats: { strippedHtmlArgs, shortenedResults, charsBefore, charsAfter },
  };
}

/**
 * 上下文瘦身中间件:wrapModelCall 请求副本改写,不落任何持久化。
 * 无改动时原样透传(同一引用,零开销)。
 */
export const contextTrimMiddleware: AgentMiddleware = createMiddleware({
  name: "context_trim",
  wrapModelCall: async (request, handler) => {
    const trimmed = trimContextMessages(request.messages);
    const { stats } = trimmed;
    if (stats.strippedHtmlArgs === 0 && stats.shortenedResults === 0) {
      return handler(request);
    }
    logger.info({
      event: "agent.context_trimmed",
      strippedHtmlArgs: stats.strippedHtmlArgs,
      shortenedResults: stats.shortenedResults,
      charsBefore: stats.charsBefore,
      charsAfter: stats.charsAfter,
    });
    return handler({ ...request, messages: trimmed.messages });
  },
});
