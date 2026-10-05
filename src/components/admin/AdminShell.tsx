"use client";

/**
 * admin 壳层(M13 移动端适配):抽屉开关唯一 state 持有者。
 * ≥1024(lg)固定侧栏原样;<1024 抽屉化——顶栏 hamburger 开,
 * 遮罩 / Esc / 路由切换关。z 阶梯:遮罩与侧栏同 z-20 < 弹层 z-30/z-50。
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminTopbar from "@/components/admin/AdminTopbar";

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
    <>
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}
      <AdminSidebar open={open} onClose={() => setOpen(false)} />
      <div className="lg:ml-[var(--admin-sidebar-w)]">
        <AdminTopbar nickname={nickname} phone={phone} onMenu={() => setOpen(true)} />
        <main className="px-4 py-4 sm:px-6 sm:py-6">{children}</main>
      </div>
    </>
  );
}
