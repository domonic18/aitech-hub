"use client";
/**
 * 「问助手」右侧抽屉(K2.5,arch/04 §3.1;挂载 /search page):
 * 答案卡追问 chips / 「继续深挖」派发 search:agent-ask(detail {question, send})
 * 唤起并预填/直发。编排:受控 threadId + 会话列表(plain fetch,无 react-query)
 * + todos 状态,内部装配 AgentRuntimeProvider。开抽屉才挂 Provider
 * (不打开零开销);Escape / 遮罩点击关闭;左缘拖拽调宽(localStorage 记忆)。
 * K2.6 身份分流:GET /api/auth/session 判 admin——游客不渲染会话侧栏/
 * 新建入口(单列全宽),composer 显限额口径;会话过期(游客 2h 清退)横幅
 * +复位新会话自愈。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentTodo } from "@/lib/agent/todos";

import AgentRuntimeProvider from "./AgentRuntimeProvider";
import AgentSidebar, { type AgentSessionItem } from "./AgentSidebar";
import AgentThread, { type PendingAsk } from "./AgentThread";
import TodoListBar from "./TodoListBar";

const SESSIONS_URL = "/api/search/agent/threads";
const SESSION_STATE_URL = "/api/auth/session";

const DRAWER_WIDTH_KEY = "agent.drawer.width";
const DRAWER_WIDTH_MIN = 420;
const DRAWER_WIDTH_MAX = 920;

/** 宽度夹取:420~920 且至多留出视口左侧 120px(拖拽/恢复均收敛) */
function clampWidth(w: number): number {
  const max = Math.min(DRAWER_WIDTH_MAX, window.innerWidth - 120);
  return Math.round(Math.min(Math.max(w, DRAWER_WIDTH_MIN), Math.max(max, DRAWER_WIDTH_MIN)));
}

type SessionPhase = "idle" | "loading" | "ready";
type AuthPhase = "loading" | "admin" | "guest";

export default function AgentDrawer(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const [todos, setTodos] = useState<AgentTodo[]>([]);
  const [sessions, setSessions] = useState<AgentSessionItem[]>([]);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>("idle");
  const [banner, setBanner] = useState<string | null>(null);
  const [auth, setAuth] = useState<AuthPhase>("loading");
  // 宽度:默认 520;挂载后读 localStorage(避免 SSR/水合不一致),拖拽实时夹取
  const [width, setWidth] = useState(520);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;
  const resizeStart = useRef({ x: 0, w: 520 });
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(DRAWER_WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= DRAWER_WIDTH_MIN) setWidth(clampWidth(saved));
  }, []);

  // 拖拽中:window 级 pointer 监听(移出把手也不丢);抬起即持久化
  useEffect(() => {
    if (!resizing) return undefined;
    document.body.style.userSelect = "none";
    const onMove = (e: PointerEvent): void => {
      setWidth(clampWidth(resizeStart.current.w + (resizeStart.current.x - e.clientX)));
    };
    const onUp = (): void => {
      setResizing(false);
      window.localStorage.setItem(DRAWER_WIDTH_KEY, String(widthRef.current));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizing]);

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
      setSessionPhase("idle"); // 列表失败不打断主流程(新建/追问仍可用)
    }
  }, []);

  // 开抽屉判身份一次(滑动续期顺带发生;抽屉生命周期内角色不变)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAuth("loading");
    void (async () => {
      try {
        const res = await fetch(SESSION_STATE_URL);
        const body = (await res.json()) as {
          code: number;
          data?: { user?: { role?: string } | null };
        };
        if (cancelled) return;
        setAuth(body.code === 0 && body.data?.user?.role === "admin" ? "admin" : "guest");
      } catch {
        if (!cancelled) setAuth("guest"); // 查询失败按游客兜底(后端同口径)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const onThreadIdChange = useCallback(
    (id: string | undefined) => {
      // 首条消息真实建线程后回填;新会话置 undefined 由 runtime 自建
      setThreadId(id);
      // 游客无线程列表(Guest GET 恒空),不空转
      if (id !== undefined && auth === "admin") void refreshSessions();
    },
    [refreshSessions, auth],
  );

  // search:agent-ask 入口(chips 直发 / 深挖预填);打开时拉会话列表
  useEffect(() => {
    const onAsk = (e: Event): void => {
      const detail = (e as CustomEvent<{ question?: unknown; send?: unknown }>).detail;
      if (typeof detail?.question !== "string" || detail.question.trim() === "") return;
      setPending({ question: detail.question, send: detail.send === true });
      setOpen(true);
    };
    window.addEventListener("search:agent-ask", onAsk);
    return () => window.removeEventListener("search:agent-ask", onAsk);
  }, []);
  useEffect(() => {
    if (open && auth === "admin") void refreshSessions();
  }, [open, auth, refreshSessions]);

  // Escape 关闭(输入框聚焦时也生效;遮罩点击同关闭)
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const handleNewThread = useCallback((): void => {
    setThreadId(undefined);
    setTodos([]);
    setBanner(null);
  }, []);

  const handleSwitchThread = useCallback((id: string): void => {
    if (id === threadIdRef.current) return;
    setThreadId(id);
    setTodos([]); // 计划条随会话切换重置(历史计划不恢复,见 arch/04 §3.2)
    setBanner(null);
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

  const onTodos = useCallback((next: AgentTodo[]): void => setTodos(next), []);
  const onError = useCallback((message: string): void => setBanner(message), []);
  const onPendingConsumed = useCallback((): void => setPending(null), []);
  /** K2.6 游客过期自愈:复位新会话 + 横幅指引重发 */
  const onSessionExpired = useCallback((): void => {
    setThreadId(undefined);
    setTodos([]);
    setBanner("会话已过期,已开启新会话,请重新发送");
  }, []);

  if (!open) return <div />;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label="问助手">
      <button
        type="button"
        aria-label="关闭抽屉"
        onClick={() => setOpen(false)}
        className="absolute inset-0 h-full w-full cursor-default bg-black/45"
      />
      <aside
        className="absolute right-0 top-0 flex h-full max-w-full flex-col border-l border-line bg-bg shadow-lg"
        style={{ width }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整宽度"
          onPointerDown={(e) => {
            resizeStart.current = { x: e.clientX, w: widthRef.current };
            setResizing(true);
          }}
          className={`absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize ${
            resizing ? "bg-accent/40" : "hover:bg-accent/25"
          }`}
        />
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
          <svg className="ic ic-sm text-accent-hover" aria-hidden="true">
            <use href="#i-robot" />
          </svg>
          <span className="font-mono text-[13px] text-text-1">问助手</span>
          <span className="font-mono text-[10.5px] text-text-3">agent.digest</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setOpen(false)}
            className="ml-auto cursor-pointer rounded p-1 text-text-3 hover:bg-panel-2 hover:text-text-1"
          >
            <svg className="ic ic-sm" aria-hidden="true">
              <use href="#i-close" />
            </svg>
          </button>
        </header>

        {banner ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber/40 bg-amber/10 px-4 py-2 text-xs text-amber-hi">
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

        <div className="flex min-h-0 flex-1">
          {/* K2.6:仅 admin 渲染会话侧栏(游客单列全宽,无列表/新建入口) */}
          {auth === "admin" && (
            <div className="w-[176px] shrink-0">
              <AgentSidebar
                sessions={sessions}
                activeThreadId={threadId}
                isLoading={sessionPhase === "loading"}
                onNewThread={handleNewThread}
                onSwitchThread={handleSwitchThread}
                onDeleteThread={handleDeleteThread}
              />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <TodoListBar todos={todos} />
            <div className="min-h-0 flex-1">
              <AgentRuntimeProvider
                threadId={threadId}
                onThreadIdChange={onThreadIdChange}
                onTodos={onTodos}
                onError={onError}
                onSessionExpired={onSessionExpired}
              >
                <AgentThread
                  pending={pending}
                  onPendingConsumed={onPendingConsumed}
                  guestMode={auth === "guest"}
                />
              </AgentRuntimeProvider>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
