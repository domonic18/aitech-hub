"use client";
/**
 * Drawer 会话运行时防腐层(K2.5,平移 ai-invest runtimeAdapter 四件套):
 * 集中 @assistant-ui/react-langgraph 与 @langchain/langgraph-sdk 的全部集成点
 * (threadListAdapter / load / stream / eventHandlers),Provider 只做装配。
 * 协议对接:threads 建删与 state 走自有 fetch(apiEnvelope 契约,cookie 同源自带);
 * 仅 runs.stream 用官方 SDK Client(其价值在 SSE 解析;apiUrl 必须绝对地址,
 * SDK 内部 new URL(apiUrl + path) 拼接)。
 * 纪律:本模块不订阅任何 React 状态,todos 经 onTodos 回调上抛 Drawer。
 */
import { InMemoryThreadListAdapter } from "@assistant-ui/react";
import type { LangChainMessage, LangGraphStreamCallback } from "@assistant-ui/react-langgraph";
import { Client } from "@langchain/langgraph-sdk";

import { extractTodos, type AgentTodo } from "@/lib/agent/todos";

const API_BASE = "/api/search/agent";
/** runs.stream 的 assistant_id(后端只认 input,此值仅占位) */
const AGENT_ID = "search-agent";

export interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

function apiOrigin(): string {
  // 同源直连(cookie 自动携带);SSR 阶段不会调用(组件均 "use client")
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** 自有端点统一解包:HTTP 200 且业务 code=0 才算成功(code 是业务码非 HTTP 状态) */
async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiOrigin()}${input}`, init);
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    /* 落入下方统一抛错 */
  }
  if (!res.ok || body === null || body.code !== 0) {
    throw new Error(body?.message ?? `请求失败(${res.status})`);
  }
  return body.data;
}

function createAgentClient(): Client {
  // langgraph-sdk 必须绝对地址;同源无需 apiKey/鉴权头
  return new Client({ apiUrl: `${apiOrigin()}${API_BASE}`, apiKey: null });
}

export interface AgentRuntimeAdapterOptions {
  /** updates 通道提取出的执行计划上抛(Drawer state 渲染计划条) */
  onTodos?: (todos: AgentTodo[]) => void;
  /** 建线程等自有端点失败(如日配额超限)上抛人话提示(Drawer 横幅) */
  onError?: (message: string) => void;
}

export interface AgentRuntimeAdapter {
  threadListAdapter: InMemoryThreadListAdapter;
  load: (
    threadId: string,
    config?: { signal: AbortSignal },
  ) => Promise<{ messages: LangChainMessage[]; interrupts?: never; uiMessages?: never }>;
  stream: LangGraphStreamCallback<LangChainMessage>;
  eventHandlers: {
    onUpdates: (updates: unknown) => void;
  };
}

export function createAgentRuntimeAdapter(
  options: AgentRuntimeAdapterOptions = {},
): AgentRuntimeAdapter {
  // 后端会话即 remote 线程。InMemory adapter 不认识列表外的线程 id,切换历史
  // 会话时 fetch 会拒绝且被 runtime 静默吞掉——覆写 initialize(首条消息真实
  // create,延迟建线程省配额)与 fetch(历史会话直接采用传入 id)。
  const threadListAdapter = new InMemoryThreadListAdapter();
  threadListAdapter.initialize = async () => {
    try {
      const { threadId } = await apiJson<{ threadId: string }>(`${API_BASE}/threads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      return { remoteId: threadId, externalId: threadId };
    } catch (e) {
      const message = e instanceof Error ? e.message : "新建会话失败";
      options.onError?.(message);
      throw e;
    }
  };
  threadListAdapter.fetch = async (threadId: string) => ({
    status: "regular" as const,
    remoteId: threadId,
    externalId: threadId,
  });

  return {
    threadListAdapter,
    load: async (externalId: string) => {
      const { values } = await apiJson<{
        values: { messages?: unknown[] };
      }>(`${API_BASE}/threads/${externalId}/state`);
      return { messages: (values.messages ?? []) as LangChainMessage[] };
    },
    stream: async function* (messages, config) {
      const { externalId } = await config.initialize();
      if (!externalId) throw new Error("会话尚未初始化");
      const client = createAgentClient();
      const stream = await client.runs.stream(externalId, AGENT_ID, {
        input: messages.length ? { messages } : null,
        command: config.command as never,
        streamMode: ["messages", "updates"],
        signal: config.abortSignal,
      });
      // 帧原样透传(wire 契约由后端钉死;error 帧已带人话,前端挂末条消息)
      for await (const chunk of stream) {
        yield { event: chunk.event, data: chunk.data };
      }
    },
    eventHandlers: {
      onUpdates: (updates: unknown) => {
        const todos = extractTodos(updates);
        if (todos.length > 0) options.onTodos?.(todos);
      },
    },
  };
}
