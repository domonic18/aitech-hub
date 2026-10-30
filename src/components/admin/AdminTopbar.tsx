"use client";

/**
 * admin 顶栏(DESIGN-SPEC §3/§5):crumb 头 + 主题胶囊 + 头像菜单(点外关闭 + Esc)。
 * 退出登录走 POST /api/auth/logout(吊销 Redis jti + 清 Cookie)后回登录页。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADMIN_LOGIN_PATH } from "@/lib/auth/constants";

import ThemeToggle from "@/components/ThemeToggle";

import { crumbsOf } from "./admin-crumbs";

export default function AdminTopbar({
  nickname,
  phone,
  onMenu,
}: {
  nickname: string | null;
  phone: string;
  /** M13 移动端:传入则渲染抽屉呼出钮(<1024 显示) */
  onMenu?: () => void;
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

  const crumbs = crumbsOf(pathname);

  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between border-b border-line px-4 backdrop-blur sm:px-6"
      style={{ height: "var(--admin-header-h)", background: "var(--header-bg)" }}
    >
      <div className="flex min-w-0 items-center gap-1">
        {onMenu && (
          <button
            type="button"
            aria-label="打开菜单"
            onClick={onMenu}
            className="cursor-pointer rounded-sm p-1.5 text-text-2 hover:bg-panel-2 hover:text-text-1 lg:hidden"
          >
            <svg className="ic" aria-hidden="true">
              <use href="#i-menu" />
            </svg>
          </button>
        )}
        <div className="min-w-0 truncate font-mono text-xs text-text-3">
          {crumbs.map((c, i) => (
            <span key={c.href ?? c.label}>
              {i > 0 && <span className="mx-1">›</span>}
              {c.href ? (
                <Link href={c.href} className="hover:text-accent">
                  {c.label}
                </Link>
              ) : (
                <span className="text-text-1">{c.label}</span>
              )}
            </span>
          ))}
        </div>
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
