"use client";
/**
 * Drawer 运行时装配(瘦 Provider,平移 ai-invest):只订阅 threadId(运行时
 * 必需),全部 SDK 集成点经 runtime-adapter(useMemo 稳定引用)注入。
 * 禁止在此订阅易变业务状态——Provider 重渲染 = 抽屉全树重渲染,
 * 曾在 ai-invest 触发运行时渲染期空引用整页崩溃(纪律平移)。
 */
import type { ReactNode } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { useMemo } from "react";

import type { AgentTodo } from "@/lib/agent/todos";

import { createAgentRuntimeAdapter } from "./runtime-adapter";

interface AgentRuntimeProviderProps {
  children: ReactNode;
  /** 受控线程 id(undefined = 新会话;首条消息发送时才落库建线程) */
  threadId: string | undefined;
  onThreadIdChange: (threadId: string | undefined) => void;
  /** updates 通道执行计划上抛(Drawer 渲染 ✓/◐/○ 计划条) */
  onTodos: (todos: AgentTodo[]) => void;
  /** 自有端点失败人话提示(Drawer 横幅) */
  onError: (message: string) => void;
}

export default function AgentRuntimeProvider({
  children,
  threadId,
  onThreadIdChange,
  onTodos,
  onError,
}: AgentRuntimeProviderProps): React.ReactElement {
  const adapter = useMemo(
    () => createAgentRuntimeAdapter({ onTodos, onError }),
    [onTodos, onError],
  );

  const runtime = useLangGraphRuntime({
    threadId,
    onThreadIdChange,
    unstable_allowCancellation: true,
    unstable_threadListAdapter: adapter.threadListAdapter,
    load: adapter.load,
    stream: adapter.stream,
    eventHandlers: adapter.eventHandlers,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
