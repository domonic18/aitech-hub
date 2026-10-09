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

interface Crumb {
  label: string;
  /** 末级 crumb 无 href(纯文本);中间级必带,可点击返回 */
  href?: string;
}

/** 已知段文案;未知段按 decodeURIComponent 兜底(不再裸输出路径) */
const SEG_LABEL: Record<string, string> = {
  posts: "文章管理",
  media: "媒体库",
  users: "用户管理",
  feedback: "反馈管理",
  pats: "PAT 令牌",
  new: "新建文章",
  preview: "预览",
  settings: "站点设置",
  telegram: "电报管理",
  spider: "采集总览",
  channels: "渠道配置",
  bloggers: "博主管理",
  github: "项目展示",
  models: "模型配置",
  usage: "用量统计",
};

/** 数字段 = 文章 id(编辑页);其余未知段解码展示 */
function segLabel(seg: string): string {
  if (/^\d+$/.test(seg)) return "编辑文章";
  return SEG_LABEL[seg] ?? decodeSeg(seg);
}

function decodeSeg(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** 路径 → crumb 链(中间级全部可点击,解决"进详情后回不去"的反馈) */
function crumbsOf(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "站点统计", href: "/admin" }];
  const segs = pathname
    .replace(/^\/admin\/?/, "")
    .split("/")
    .filter(Boolean);
  let acc = "/admin";
  segs.forEach((seg, i) => {
    acc += `/${seg}`;
    crumbs.push(
      i === segs.length - 1 ? { label: segLabel(seg) } : { label: segLabel(seg), href: acc },
    );
  });
  return crumbs;
}

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
