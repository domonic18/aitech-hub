"use client";

/**
 * admin 顶栏(DESIGN-SPEC §3/§5):crumb 头 + 主题胶囊 + 头像菜单(点外关闭 + Esc)。
 * 退出登录走 POST /api/auth/logout(吊销 Redis jti + 清 Cookie)后回登录页。
 */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { ADMIN_LOGIN_PATH } from "@/lib/auth/constants";

import ThemeToggle from "./ThemeToggle";

/** 路径 → crumb 文案(M4/M5 两层;面板再增多后换注册表映射) */
function crumbOf(pathname: string): string {
  if (pathname === "/admin") return "站点统计";
  if (pathname === "/admin/posts") return "文章管理";
  if (pathname === "/admin/posts/new") return "新建文章";
  if (/^\/admin\/posts\/\d+$/.test(pathname)) return "编辑文章";
  return pathname.replace(/^\/admin\//, "").replace(/^\//, "");
}

export default function AdminTopbar({
  nickname,
  phone,
}: {
  nickname: string | null;
  phone: string;
}): React.ReactElement {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  const logout = async (): Promise<void> => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = ADMIN_LOGIN_PATH;
    }
  };

  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between border-b border-line px-6 backdrop-blur"
      style={{ height: "var(--admin-header-h)", background: "var(--header-bg)" }}
    >
      <div className="font-mono text-xs text-text-3">
        <span>admin</span>
        <span className="mx-1">›</span>
        <span className="text-text-1">{crumbOf(pathname)}</span>
      </div>

      <div className="flex items-center gap-3">
        <ThemeToggle />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-text-2 hover:bg-panel-2 hover:text-text-1"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg className="avatar-svg ic-lg" aria-hidden="true" style={{ color: "var(--accent)" }}>
              <use href="#i-avatar" />
            </svg>
            <span className="max-w-[120px] truncate text-xs">{nickname ?? phone}</span>
            <svg className="ic-sm ic" aria-hidden="true">
              <use href="#i-caret-down" />
            </svg>
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-1 w-40 rounded-md border border-line bg-panel py-1 shadow-sm"
            >
              <div className="border-b border-line px-3 py-1.5 font-mono text-[11px] text-text-3">
                {phone}
              </div>
              <button
                type="button"
                role="menuitem"
                disabled={loggingOut}
                onClick={logout}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-text-2 hover:bg-panel-2 hover:text-red disabled:opacity-50"
              >
                <svg className="ic" aria-hidden="true">
                  <use href="#i-logout" />
                </svg>
                {loggingOut ? "退出中…" : "退出登录"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
