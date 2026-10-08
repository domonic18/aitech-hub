"use client";
/**
 * 会话侧栏(K2.5,arch/04 §3.1「线程列表 今/昨/更早 + 新建」;平移 ai-invest,
 * Date 原生不引 dayjs)。删除为两步确认(3s 未点确认自动复位),站内无 antd
 * Popconfirm。空态引导唤起式深挖。分组逻辑在 session-groups(纯函数可测)。
 */
import { useEffect, useMemo, useState } from "react";

import { groupSessions, type GroupedSessions } from "./session-groups";

export interface AgentSessionItem {
  id: string;
  title: string | null;
  createdAt: string;
  lastMessageAt: string;
}

const SECTION_TITLES: { key: keyof GroupedSessions; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "earlier", label: "更早" },
];

interface AgentSidebarProps {
  sessions: AgentSessionItem[];
  activeThreadId: string | undefined;
  isLoading: boolean;
  onNewThread: () => void;
  onSwitchThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
}

export default function AgentSidebar({
  sessions,
  activeThreadId,
  isLoading,
  onNewThread,
  onSwitchThread,
  onDeleteThread,
}: AgentSidebarProps): React.ReactElement {
  const grouped = useMemo(() => groupSessions(sessions), [sessions]);
  // 两步删除确认:armedId 为待确认项;3s 未确认自动复位(无全局监听,纯定时)
  const [armedId, setArmedId] = useState<string | null>(null);
  useEffect(() => {
    if (armedId === null) return undefined;
    const timer = setTimeout(() => setArmedId(null), 3000);
    return () => clearTimeout(timer);
  }, [armedId]);

  return (
    <div className="flex h-full shrink-0 flex-col border-r border-line">
      <div className="p-2.5">
        <button
          type="button"
          onClick={onNewThread}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line bg-panel-2 py-1.5 font-mono text-xs text-text-1 hover:border-accent/40 hover:text-accent-hover"
        >
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-plus" />
          </svg>
          新会话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-3">
        {isLoading ? (
          <div className="py-8 text-center font-mono text-xs text-text-3">加载中…</div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs leading-[1.9] text-text-3">
            暂无会话
            <br />
            从答案卡「继续深挖」唤起
          </div>
        ) : (
          SECTION_TITLES.map(({ key, label }) =>
            grouped[key].length > 0 ? (
              <div key={key} className="mb-3">
                <div className="mb-1 ml-2 font-mono text-[11px] text-text-3">{label}</div>
                <div className="space-y-0.5">
                  {grouped[key].map((s) => {
                    const isActive = s.id === activeThreadId;
                    const armed = armedId === s.id;
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSwitchThread(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSwitchThread(s.id);
                          }
                        }}
                        className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left ${
                          isActive
                            ? "bg-accent-dim text-accent-hover"
                            : "text-text-2 hover:bg-panel-2"
                        }`}
                      >
                        <span
                          className="min-w-0 flex-1 truncate text-xs"
                          title={s.title ?? undefined}
                        >
                          {s.title?.trim() || "新会话"}
                        </span>
                        <button
                          type="button"
                          title="删除会话"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (armed) {
                              setArmedId(null);
                              onDeleteThread(s.id);
                            } else {
                              setArmedId(s.id);
                            }
                          }}
                          className={`shrink-0 cursor-pointer rounded p-1 ${
                            armed
                              ? "text-red-hi"
                              : "text-text-3 opacity-0 hover:text-red-hi group-hover:opacity-100"
                          }`}
                        >
                          <svg className="ic ic-sm" aria-hidden="true">
                            <use href="#i-delete" />
                          </svg>
                          {armed ? <span className="ml-1 text-[10px]">确认?</span> : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null,
          )
        )}
      </div>
    </div>
  );
}
