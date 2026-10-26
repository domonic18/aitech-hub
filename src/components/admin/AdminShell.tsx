"use client";

/**
 * admin 壳层(M13 移动端适配):抽屉开关唯一 state 持有者。
 * ≥1024(lg)固定侧栏原样;<1024 抽屉化——顶栏 hamburger 开,
 * 遮罩 / Esc / 路由切换关。z 阶梯:遮罩与侧栏同 z-20 < 弹层 z-30/z-50。
 * 侧栏宽度/收起(2026-10-24 验收反馈问题三):展开宽经内联
 * --admin-sidebar-w 注入(拖拽改宽,内容区 margin 同步跟随);收起走
 * lg:w-14 / lg:ml-14 类切换(移动端抽屉不受影响,始终全宽全文字);
 * 偏好 localStorage 持久化,mount 后恢复(hydrated 门闩防默认值覆盖存储)。
 */
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminTopbar from "@/components/admin/AdminTopbar";
import ToastProvider from "@/components/admin/Toast";
import {
  loadSidebarPrefs,
  saveSidebarPrefs,
  type SidebarPrefs,
} from "@/components/admin/sidebar-prefs";

export default function AdminShell({
  nickname,
  phone,
  children,
}: {
  nickname: string | null;
  phone: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [sidebar, setSidebar] = useState<SidebarPrefs>({ w: 220, collapsed: false });
  const [hydrated, setHydrated] = useState(false);

  // mount 恢复偏好(SSR 期默认 220px 展开,恢复后一帧内跟随存储值)
  useEffect(() => {
    setSidebar(loadSidebarPrefs());
    setHydrated(true);
  }, []);

  // 偏好统一持久化出口(拖拽/收起/复位全走 state,这里集中落盘)
  useEffect(() => {
    if (hydrated) saveSidebarPrefs(sidebar);
  }, [hydrated, sidebar]);

  const handleWidthChange = useCallback((w: number) => {
    setSidebar((p) => ({ ...p, w }));
  }, []);

  const handleToggleCollapsed = useCallback(() => {
    setSidebar((p) => ({ ...p, collapsed: !p.collapsed }));
  }, []);

  // 路由变化(含前进/后退)收起抽屉——移动端点导航后应立即看到内容
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // 抽屉打开时:Esc 关闭 + 锁 body 滚动(防遮罩下底层列表跟随滚动)
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    // 展开宽经 CSS 变量下发(fixed 侧栏与内容 margin 同源继承)
    <ToastProvider>
      <div style={{ "--admin-sidebar-w": `${sidebar.w}px` } as React.CSSProperties}>
        {open && (
          <div
            className="fixed inset-0 z-20 bg-black/40 lg:hidden"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
        )}
        <AdminSidebar
          open={open}
          onClose={() => setOpen(false)}
          collapsed={sidebar.collapsed}
          width={sidebar.w}
          onToggleCollapsed={handleToggleCollapsed}
          onWidthChange={handleWidthChange}
        />
        <div className={sidebar.collapsed ? "lg:ml-14" : "lg:ml-[var(--admin-sidebar-w)]"}>
          <AdminTopbar nickname={nickname} phone={phone} onMenu={() => setOpen(true)} />
          <main className="px-4 py-4 sm:px-6 sm:py-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
