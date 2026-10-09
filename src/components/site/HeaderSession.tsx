"use client";

/**
 * 站头登录态(M21 批⑤,提案 §8):客户端 island 挂载后查 /api/auth/session
 * ——不读 cookie 保 ISR 静态面;未登录渲染「登录」,已登录渲染「退出」
 * (session 仅含 sub/role,无昵称,不渲染用户名)。付费解锁引导落点。
 */
import Link from "next/link";
import { useEffect, useState } from "react";

export default function HeaderSession(): React.ReactElement {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((b: { data?: { user: unknown } | null }) => setLoggedIn(Boolean(b.data?.user)))
      .catch(() => setLoggedIn(false));
  }, []);

  async function logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/"; // 整跳清服务端组件态
  }

  if (loggedIn === null) return <span className="w-10" />; // 占位防布局跳动
  if (!loggedIn) {
    return (
      <Link
        href="/login"
        className="whitespace-nowrap rounded-sm px-2 py-1.5 text-text-2 hover:bg-panel-2 hover:text-text-1 sm:px-3"
      >
        登录
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void logout()}
      className="cursor-pointer whitespace-nowrap rounded-sm px-2 py-1.5 text-text-2 hover:bg-panel-2 hover:text-text-1 sm:px-3"
    >
      退出
    </button>
  );
}
