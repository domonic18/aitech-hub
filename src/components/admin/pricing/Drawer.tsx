"use client";

/**
 * 后台右侧抽屉壳(M56 策展台重构):低频新建/编辑表单从常驻表单格改抽屉——
 * 列表首屏让位给筛选与数据(行业常规);Esc/遮罩点击关闭;开时锁 body 滚动。
 */
import { useEffect } from "react";

export default function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-full max-w-[460px] flex-col border-l border-line bg-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h4 className="text-sm font-semibold text-text-1">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-sm p-1 text-text-2 hover:bg-panel-2 hover:text-text-1"
          >
            <svg className="ic" aria-hidden="true">
              <use href="#i-close" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer !== undefined && <div className="border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}
