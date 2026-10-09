"use client";
/**
 * 悬浮助手卡片(M22 批④,需求6):右下角 ≈400px 聊天卡(用户拍板卡片形态,
 * 非 /search 全高抽屉)。编排复用 agent 域件:AgentRuntimeProvider/AgentThread/
 * AgentSidebar(登录身份有会话列表,覆盖式面板;游客单列)。懒挂载:开卡才装
 * Provider(不开零开销,AgentDrawer 同纪律);Escape/收起按钮关闭。「隐藏」
 * 写显隐偏好后关卡(FAB 退化为唤起点)。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentTodo } from "@/lib/agent/todos";

import AgentRuntimeProvider from "@/components/site/agent/AgentRuntimeProvider";
import AgentSidebar, { type AgentSessionItem } from "@/components/site/agent/AgentSidebar";
import AgentThread, { type PendingAsk } from "@/components/site/agent/AgentThread";
import TodoListBar from "@/components/site/agent/TodoListBar";

const SESSIONS_URL = "/api/search/agent/threads";
const SESSION_STATE_URL = "/api/auth/session";

export type AssistantAuth = "loading" | "member" | "guest";

/** FAB 转交的预置问题(agent:open detail;nonce 变化即重新注入) */
type InjectAsk = PendingAsk & { nonce: number };

interface AssistantCardProps {
  /** FAB 侧已判身份(开卡时复判一次,登录态可能已变) */
  onClose: () => void;
  onHide: () => void;
  injectAsk?: InjectAsk | null;
}

export default function AssistantCard({
  onClose,
  onHide,
  injectAsk,
}: AssistantCardProps): React.ReactElement {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const [todos, setTodos] = useState<AgentTodo[]>([]);
  const [sessions, setSessions] = useState<AgentSessionItem[]>([]);
  const [sessionPhase, setSessionPhase] = useState<"idle" | "loading" | "ready">("idle");
  const [listOpen, setListOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [auth, setAuth] = useState<AssistantAuth>("loading");
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  const refreshSessions = useCallback(async (): Promise<void> => {
    setSessionPhase("loading");
    try {
      const res = await fetch(SESSIONS_URL);
      const body = (await res.json()) as { code: number; data?: AgentSessionItem[] };
      if (res.ok && body.code === 0 && Array.isArray(body.data)) {
        setSessions(body.data);
        setSessionPhase("ready");
      } else {
        setSessionPhase("idle");
      }
    } catch {
      setSessionPhase("idle");
    }
  }, []);

  // 开卡判身份一次(抽屉同款:卡生命周期内角色不变)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(SESSION_STATE_URL);
        const body = (await res.json()) as {
          code: number;
          data?: { user?: { role?: string } | null };
        };
        if (cancelled) return;
        const role = body.code === 0 ? body.data?.user?.role : undefined;
        setAuth(role === "admin" || role === "user" ? "member" : "guest");
      } catch {
        if (!cancelled) setAuth("guest");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onThreadIdChange = useCallback(
    (id: string | undefined) => {
      setThreadId(id);
      if (id !== undefined) void refreshSessions();
    },
    [refreshSessions],
  );

  useEffect(() => {
    if (auth === "member") void refreshSessions();
  }, [auth, refreshSessions]);

  // agent:open 预置问题(批⑤「联系我们」直发引导;nonce 变化可重复注入,
  // 不整卡重挂——保留当前线程与输入态)
  useEffect(() => {
    if (injectAsk) setPending({ question: injectAsk.question, send: injectAsk.send });
  }, [injectAsk]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 隐藏=只上报意图,持久化(PATCH/localStorage)由 FAB 单点收敛
  const handleHide = useCallback((): void => {
    onHide();
  }, [onHide]);

  const handleNewThread = useCallback((): void => {
    setThreadId(undefined);
    setTodos([]);
    setBanner(null);
  }, []);

  const handleSwitchThread = useCallback((id: string): void => {
    if (id === threadIdRef.current) return;
    setThreadId(id);
    setTodos([]);
    setBanner(null);
    setListOpen(false);
  }, []);

  const handleDeleteThread = useCallback(
    (id: string): void => {
      void (async () => {
        try {
          const res = await fetch(`${SESSIONS_URL}/${id}`, { method: "DELETE" });
          const body = (await res.json()) as { code: number };
          if (!res.ok || body.code !== 0) throw new Error("删除失败");
        } catch {
          setBanner("删除失败,请稍后再试");
        }
        if (id === threadIdRef.current) handleNewThread();
        void refreshSessions();
      })();
    },
    [handleNewThread, refreshSessions],
  );

  return (
    <div
      className="fixed bottom-20 right-4 z-40 flex h-[min(620px,calc(100vh-7rem))] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-line bg-bg shadow-lg sm:right-5"
      role="dialog"
      aria-label="AI 助手"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-2.5">
        <svg className="ic ic-sm text-accent-hover" aria-hidden="true">
          <use href="#i-robot" />
        </svg>
        <span className="font-mono text-[13px] text-text-1">AI 助手</span>
        {auth === "member" && (
          <button
            type="button"
            aria-label="会话列表"
            onClick={() => setListOpen((v) => !v)}
            className={`ml-1 cursor-pointer rounded p-1 hover:bg-panel-2 ${
              listOpen ? "text-accent-hover" : "text-text-3 hover:text-text-1"
            }`}
          >
            <svg className="ic ic-sm" aria-hidden="true">
              <use href="#i-bars" />
            </svg>
          </button>
        )}
        <button
          type="button"
          title="隐藏助手(可从右下角唤起点再呼出)"
          aria-label="隐藏助手"
          onClick={handleHide}
          className="ml-auto cursor-pointer rounded p-1 text-text-3 hover:bg-panel-2 hover:text-text-1"
        >
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-eye" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="收起"
          onClick={onClose}
          className="cursor-pointer rounded p-1 text-text-3 hover:bg-panel-2 hover:text-text-1"
        >
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-close" />
          </svg>
        </button>
      </header>

      {banner ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber/40 bg-amber/10 px-3.5 py-2 text-xs text-amber-hi">
          {banner}
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setBanner(null)}
            className="ml-auto cursor-pointer text-amber-hi"
          >
            <svg className="ic ic-sm" aria-hidden="true">
              <use href="#i-close" />
            </svg>
          </button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <TodoListBar todos={todos} />
        <div className="min-h-0 flex-1">
          <AgentRuntimeProvider
            threadId={threadId}
            onThreadIdChange={onThreadIdChange}
            onTodos={setTodos}
            onError={setBanner}
            onSessionExpired={() => {
              setThreadId(undefined);
              setTodos([]);
              setBanner("会话已过期,已开启新会话,请重新发送");
            }}
          >
            <AgentThread
              pending={pending}
              onPendingConsumed={() => setPending(null)}
              guestMode={auth === "guest"}
            />
          </AgentRuntimeProvider>
        </div>
        {/* 会话列表覆盖面板(登录身份;游客无列表语义) */}
        {auth === "member" && listOpen && (
          <div className="absolute inset-0 z-10 flex flex-col bg-bg">
            <div className="flex shrink-0 items-center justify-between border-b border-line px-3.5 py-2">
              <span className="font-mono text-xs text-text-2">会话列表</span>
              <button
                type="button"
                aria-label="收起列表"
                onClick={() => setListOpen(false)}
                className="cursor-pointer rounded p-1 text-text-3 hover:bg-panel-2 hover:text-text-1"
              >
                <svg className="ic ic-sm" aria-hidden="true">
                  <use href="#i-close" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <AgentSidebar
                sessions={sessions}
                activeThreadId={threadId}
                isLoading={sessionPhase === "loading"}
                onNewThread={() => {
                  handleNewThread();
                  setListOpen(false);
                }}
                onSwitchThread={handleSwitchThread}
                onDeleteThread={handleDeleteThread}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
