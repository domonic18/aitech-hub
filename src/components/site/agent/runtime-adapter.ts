"use client";
/**
 * Drawer 会话运行时防腐层(K2.5,平移 ai-invest runtimeAdapter 四件套):
 * 集中 @assistant-ui/react-langgraph 与自有 SSE 解析(K2.6 起)的全部集成点
 * (threadListAdapter / load / stream / eventHandlers),Provider 只做装配。
 * 协议对接:threads 建删与 state 走自有 fetch(apiEnvelope 契约,cookie 同源自带);
 * runs.stream 亦为自有 fetch+sse.ts 帧解析——官方 SDK Client 退役:其 AsyncCaller
 * 对非 2xx reject Response 且包装 new Error(response),message 变 "[object Response]",
 * apiEnvelope 人话/状态码全丢 → 429 配额与 404 过期既无法分流还会盲重试等待
 * (用户实测:3 问后静默停止无提示,控制台连环 429)。
 * 纪律:本模块不订阅任何 React 状态,todos 经 onTodos 回调上抛 Drawer。
 */
import { InMemoryThreadListAdapter } from "@assistant-ui/react";
import type {
  LangChainMessage,
  LangGraphInterruptState,
  LangGraphStreamCallback,
} from "@assistant-ui/react-langgraph";

import { createSseEventReader } from "@/lib/agent/sse";
import { extractTodos, type AgentTodo } from "@/lib/agent/todos";

const API_BASE = "/api/search/agent";

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

/** 非 2xx 响应解 apiEnvelope 人话(代理 HTML 错误页等非 JSON 落状态码兜底) */
async function envelopeMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as Envelope<unknown> | null;
    if (body !== null && typeof body.message === "string" && body.message !== "") {
      return body.message;
    }
  } catch {
    /* 非 JSON,落下方兜底 */
  }
  return `请求失败(${res.status})`;
}

/** SDK 流错误形态不定(Error/ApiError/响应体文本),统一取 message 判过期 */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(e);
}

function isSessionExpired(e: unknown): boolean {
  return SESSION_EXPIRED_RE.test(errText(e));
}

/** 自愈:换人话抛出(Drawer 同步横幅+复位线程) */
function selfHealError(onSessionExpired?: () => void): Error {
  onSessionExpired?.();
  return new Error("会话已过期,已开启新会话,请重新发送");
}

export interface AgentRuntimeAdapterOptions {
  /** updates 通道提取出的执行计划上抛(Drawer state 渲染计划条) */
  onTodos?: (todos: AgentTodo[]) => void;
  /** 建线程等自有端点失败(如日配额超限)上抛人话提示(Drawer 横幅) */
  onError?: (message: string) => void;
  /** 会话已过期/不存在(K2.6 游客 2h 清退)→ Drawer 复位新会话自愈 */
  onSessionExpired?: () => void;
  /** run 起止上报(stream 生成器进出;宿主运行中暂缓受控 threadId 回写,
   * 防 SDK 受控切换 abort 在跑的 run——2026-10-09 FAB 首条消息闪断根因) */
  onRunActiveChange?: (active: boolean) => void;
}

/** 后端 404 话术(身份路由统一);命中即走自愈而非当普通错误挂横幅 */
const SESSION_EXPIRED_RE = /会话已过期|会话不存在/;

export interface AgentRuntimeAdapter {
  threadListAdapter: InMemoryThreadListAdapter;
  load: (
    threadId: string,
    config?: { signal: AbortSignal },
  ) => Promise<{
    messages: LangChainMessage[];
    /** 挂起中断(state 路由水合;SDK reconcileInterrupt 恢复提问卡) */
    interrupts?: LangGraphInterruptState[];
    uiMessages?: never;
  }>;
  stream: LangGraphStreamCallback<LangChainMessage>;
  eventHandlers: {
    onUpdates: (updates: unknown) => void;
    /** 哨兵帧(如 wire end)吞掉,防 useLangGraphMessages 未知名 console.warn */
    onCustomEvent: (eventType: string, data: unknown) => void;
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
      try {
        const { values, interrupts } = await apiJson<{
          values: { messages?: unknown[] };
          interrupts?: LangGraphInterruptState[];
        }>(`${API_BASE}/threads/${externalId}/state`);
        return {
          messages: (values.messages ?? []) as LangChainMessage[],
          // 刷新/切会话恢复 ask_user 提问卡(SDK reconcileInterrupt;无中断
          // 时后端返回空数组,置 undefined 走无中断路径)
          ...(interrupts && interrupts.length > 0 ? { interrupts } : {}),
        };
      } catch (e) {
        if (isSessionExpired(e)) throw selfHealError(options.onSessionExpired);
        throw e;
      }
    },
    stream: async function* (messages, config) {
      options.onRunActiveChange?.(true);
      try {
        const { externalId } = await config.initialize();
        if (!externalId) throw new Error("会话尚未初始化");
        // 自有 fetch 替代官方 SDK(头注:错误包装丢人话 + 盲重试)。载荷与 SDK
        // 同形:后端 bodySchema 只消费 input,command(resume/regenerate)透传备用。
        let res: Response;
        try {
          res = await fetch(`${apiOrigin()}${API_BASE}/threads/${externalId}/runs/stream`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input: messages.length ? { messages } : null,
              ...(config.command ? { command: config.command } : {}),
            }),
            signal: config.abortSignal,
          });
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") throw e; // 用户主动停,静默
          const message = "网络连接异常,请稍后重试";
          options.onError?.(message);
          throw new Error(message);
        }
        if (!res.ok || !res.body) {
          // 护栏前置拒绝(429 配额/频控、404 过期等)全走这里:人话分流
          const message = await envelopeMessage(res);
          if (isSessionExpired(message)) throw selfHealError(options.onSessionExpired);
          options.onError?.(message);
          throw new Error(message);
        }
        // 帧原样透传(sse.ts 按 encodeWireEvent 逆变换;error 帧已带人话,前端挂末条消息)
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const frames = createSseEventReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const frame of frames.push(decoder.decode(value, { stream: true }))) {
              yield frame;
            }
          }
          for (const frame of frames.end()) {
            yield frame;
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            /* 流已断 */
          }
        }
      } finally {
        options.onRunActiveChange?.(false); // 正常收尾/中断/异常全路径覆盖
      }
    },
    eventHandlers: {
      onUpdates: (updates: unknown) => {
        const todos = extractTodos(updates);
        if (todos.length > 0) options.onTodos?.(todos);
      },
      // end 帧仅是后端收尾哨兵(wire.ts),无消费方;不注册时 useLangGraphMessages
      // 对未知名 console.warn("Unhandled event received")——控制台噪音,K2.6 修复
      onCustomEvent: () => {},
    },
  };
}
