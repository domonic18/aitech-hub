"use client";

/**
 * 导航二级菜单(M56 验收反馈二):「专题」聚合项的悬停下拉。
 * 不用 CSS group-hover+absolute——导航容器 overflow-x-auto(窄屏横滚兜底)
 * 会裁剪绝对定位子元素;此件用 React 态 + fixed 定位(按触发钮视口位置
 * 对齐),逃出裁剪上下文。触屏无悬停,点击直达索引页。
 */
import Link from "next/link";
import { useRef, useState } from "react";

export default function TopicNavMenu({
  label,
  href,
  children,
}: {
  label: string;
  href: string;
  children: ReadonlyArray<{ href: string; label: string }>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 56 });
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openMenu(): void {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ left: rect.left, top: rect.bottom + 4 });
    setOpen(true);
  }
  function scheduleClose(): void {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <div onMouseEnter={openMenu} onMouseLeave={scheduleClose} className="relative">
      <Link
        ref={triggerRef}
        href={href}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-1.5 text-text-2 hover:bg-panel-2 hover:text-text-1 sm:px-3"
      >
        {label}
        {/* 细描边 chevron(替代 sprite 面填充箭头);悬停变色+转向 */}
        <svg
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 text-text-3 transition-transform duration-150 group-hover:text-text-1 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </Link>
      {open && (
        <div
          className="fixed z-50 min-w-[176px] rounded-md border border-line bg-panel py-1 shadow-lg"
          style={pos}
          onMouseEnter={openMenu}
          onMouseLeave={scheduleClose}
        >
          {children.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              onClick={() => setOpen(false)}
              className="block whitespace-nowrap px-3 py-1.5 text-[13px] text-text-2 hover:bg-panel-2 hover:text-text-1"
            >
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
