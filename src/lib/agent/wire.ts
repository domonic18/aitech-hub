/**
 * SSE 线协议(K2.5,arch/04 §3.3「Route Handler 自实现 LangGraph 兼容流」):
 * 帧名与载荷以已装解析器实测钉死(2026-10-07,@langchain/langgraph-sdk 1.12.1
 * streamWithRetry 原样透传 {event,data};@assistant-ui/react-langgraph 0.14.33
 * useLangGraphMessages switch——normalizeLangGraphTupleMessage 要求 chunk 型
 * tool_call_chunks[].index 为 number)。平移 ai-invest wire.py 契约,收敛此单文件。
 */
import type { BaseMessage } from "@langchain/core/messages";

/** useLangGraphMessages 认识的帧名(未知名落 onCustomEvent;end 帧仅作收尾哨兵) */
export type AgentWireEvent =
  "metadata" | "messages" | "messages/partial" | "updates" | "values" | "error" | "end";

/** AIMessageChunk 的 tool_call_chunks[] 扁平形态(index 必须为 number) */
interface WireToolCallChunk {
  name?: string;
  args?: string;
  id?: string;
  index?: number;
  type?: string;
}

/** messages 帧载荷:元组 [消息, 元数据] */
export type WireMessageTuple = [WireMessage, Record<string, unknown>];

/**
 * 消息扁平序列化(前端 normalizeLangChainMessageChunk/isLangChainMessage 口径):
 * - chunk 型:AIMessageChunk(type 原样)挑 id/content/tool_call_chunks/usage_metadata
 * - message 型:human/ai/tool/system 挑 id/content/tool_calls/tool_call_id/name/status
 */
export function serializeWireMessage(m: BaseMessage): WireMessage {
  const t = m.getType();
  const base: WireMessage = { type: t, content: serializeContent(m.content) };
  if (m.id != null) base.id = m.id;
  const usage = (m as { usage_metadata?: unknown }).usage_metadata;
  if (usage != null) base.usage_metadata = usage;
  const responseMeta = (m as { response_metadata?: unknown }).response_metadata;
  if (responseMeta != null && hasModelName(responseMeta)) {
    base.response_metadata = { model_name: (responseMeta as { model_name?: string }).model_name };
  }
  if (t === "ai") {
    const chunks = (m as { tool_call_chunks?: unknown }).tool_call_chunks;
    if (Array.isArray(chunks)) base.tool_call_chunks = chunks.map(serializeToolCallChunk);
    const calls = (m as { tool_calls?: unknown }).tool_calls;
    if (Array.isArray(calls)) base.tool_calls = calls.map(serializeToolCall);
    if (typeof (m as { status?: unknown }).status === "string") {
      base.status = (m as unknown as { status: string }).status;
    }
  }
  if (t === "tool") {
    base.tool_call_id = (m as { tool_call_id?: string }).tool_call_id;
    base.name = (m as { name?: string }).name;
    base.status = (m as { status?: string }).status ?? "success";
  }
  return base;
}

/** wire 消息形态(宽松;前端按 type 分支取字段) */
export interface WireMessage {
  type: string;
  content: string | unknown[];
  id?: string;
  usage_metadata?: unknown;
  response_metadata?: unknown;
  tool_calls?: unknown[];
  tool_call_chunks?: WireToolCallChunk[];
  tool_call_id?: string;
  name?: string;
  status?: string;
}

function serializeContent(content: BaseMessage["content"]): string | unknown[] {
  if (typeof content === "string") return content;
  // 多模态块只留文本(本 agent 无图像输入输出面)
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: string; text?: string } => typeof c === "object" && c !== null)
      .filter((c) => c.type === "text" || c.type === "text_delta")
      .map((c) => ({ type: "text", text: c.text ?? "" }));
  }
  return [];
}

function hasModelName(meta: unknown): boolean {
  return (
    typeof meta === "object" &&
    meta !== null &&
    "model_name" in meta &&
    typeof (meta as { model_name?: unknown }).model_name === "string"
  );
}

function serializeToolCallChunk(c: unknown): WireToolCallChunk {
  const o = (c ?? {}) as Record<string, unknown>;
  const out: WireToolCallChunk = {};
  if (typeof o.name === "string") out.name = o.name;
  if (typeof o.args === "string") out.args = o.args;
  else if (o.args != null) out.args = JSON.stringify(o.args); // 对象形态兜底(防 int 断流)
  if (typeof o.id === "string") out.id = o.id;
  if (typeof o.index === "number") out.index = o.index;
  if (typeof o.type === "string") out.type = o.type;
  return out;
}

function serializeToolCall(c: unknown): unknown {
  const o = (c ?? {}) as Record<string, unknown>;
  return {
    name: typeof o.name === "string" ? o.name : "",
    args: o.args ?? {},
    id: typeof o.id === "string" ? o.id : "",
    ...(typeof o.type === "string" ? { type: o.type } : {}),
  };
}

/** SSE 帧编码(块间空行分隔;event+data 两行) */
export function encodeWireEvent(event: AgentWireEvent, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** messages 帧编码(元组载荷) */
export function encodeWireMessage(m: BaseMessage): string {
  return encodeWireEvent("messages", [serializeWireMessage(m), {}] satisfies WireMessageTuple);
}
