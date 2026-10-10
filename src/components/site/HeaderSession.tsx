"use client";

/**
 * 站头登录态(M22 批②升级:头像下拉,需求2):客户端 island 挂载后查
 * /api/auth/session——不读 cookie 保 ISR 静态面。未登录渲染「登录」;已登录
 * 渲染头像 + 下拉(个人设置/查看订单/查看消耗/退出登录),点外关 + Esc 关
 * (AdminTopbar 骨架,视觉对齐 account.html .user-drop)。下拉含查看订单/
 * 消耗入口(页面批③交付,先通导航)。
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import Avatar from "./Avatar";

interface SessionUser {
  sub: string;
  role: string;
  nickname: string | null;
  avatarPath: string | null;
}

const ROLE_LABEL: Record<string, string> = { admin: "admin · 站长", user: "注册用户" };

export default function HeaderSession(): React.ReactElement {
  /** undefined=取数中,null=未登录,对象=已登录 */
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((b: { data?: { user: SessionUser | null } | null }) => setUser(b.data?.user ?? null))
      .catch(() => setUser(null));
  }, []);

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

  async function logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/"; // 整跳清服务端组件态
  }

  if (user === undefined) {
    return (
      <span className="w-10" /> // 占位防布局跳动
    );
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className="whitespace-nowrap rounded-sm px-2 py-1.5 text-text-2 hover:bg-panel-2 hover:text-text-1 sm:px-3"
      >
        登录
      </Link>
    );
  }

  const items = [
    { href: "/account/settings/", icon: "i-user", label: "个人设置" },
    { href: "/account/orders/", icon: "i-read", label: "查看订单" },
    { href: "/account/usage/", icon: "i-book", label: "查看消耗" },
  ];

  return (
    <div className="relative flex-none" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="账号菜单"
        className="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-1 hover:bg-panel-2"
      >
        <Avatar nickname={user.nickname} avatarPath={user.avatarPath} size="sm" />
        <svg className="ic ic-sm text-text-3" aria-hidden="true">
          <use href="#i-caret-down" />
        </svg>
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-44 rounded-md border border-line bg-panel py-1.5 shadow-sm"
        >
          <div className="border-b border-line px-3.5 pb-2 pt-1.5">
            <div className="max-w-full truncate text-[13px] font-semibold text-text-1">
              {user.nickname ?? "未命名"}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-text-3">
              {ROLE_LABEL[user.role] ?? user.role}
            </div>
          </div>
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-text-2 hover:bg-panel-2 hover:text-text-1"
            >
              <svg className="ic" aria-hidden="true">
                <use href={`#${it.icon}`} />
              </svg>
              {it.label}
            </Link>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className="flex w-full cursor-pointer items-center gap-2.5 border-t border-line px-3.5 py-2 text-left text-[13px] text-red hover:bg-panel-2"
          >
            <svg className="ic" aria-hidden="true">
              <use href="#i-logout" />
            </svg>
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
