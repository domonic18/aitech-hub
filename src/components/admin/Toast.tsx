"use client";

/**
 * 全局 toast(M49 验收反馈):入队/异步动作反馈统一走轻提示——用户滚到
 * 页面任何位置都可见,替代渲染在页面顶部、底部操作时看不到的 notice 条。
 * 右下角固定(z-[70] 盖过 DialogShell z-50),success 4s / error 8s 自动
 * 消退,栈 ≤3 挤掉最老。Provider 挂 AdminShell,业务侧 useToast().push。
 */
import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastKind = "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastCtx = createContext<{ push: (kind: ToastKind, text: string) => void } | null>(null);

export function useToast(): { push: (kind: ToastKind, text: string) => void } {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}

const MAX_STACK = 3;
const TTL_MS: Record<ToastKind, number> = { success: 4000, error: 8000 };

export default function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current;
    // 超栈挤掉最老(保留最新 MAX_STACK-1 条再入新)
    setItems((prev) => [...prev.slice(-(MAX_STACK - 1)), { id, kind, text }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, TTL_MS[kind]);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {/* max-w:320px 视口下定宽 w-80 超出 right-4 边距把整页撑出横向滚动 */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto break-words rounded-sm border border-line border-l-2 bg-panel px-3 py-2 text-xs text-text-1 shadow-lg ${
              t.kind === "success" ? "border-l-green" : "border-l-red"
            }`}
          >
            <span className={`font-medium ${t.kind === "success" ? "text-green" : "text-red"}`}>
              {t.kind === "success" ? "成功" : "失败"}
            </span>
            <span className="ml-1.5">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
