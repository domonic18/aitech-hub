"use client";

/**
 * admin 登录表单(arch/05-services §3.1):POST /api/auth/login;
 * M21 批⓪ 标识符登录(手机号/用户名/邮箱),admin 惯用手机号不受影响;
 * 失败提示直接用服务端模糊文案(不区分锁定/密码错);成功回跳 next(仅 /admin 路径)。
 */
import { useState } from "react";
import type { ApiEnvelope } from "@/lib/http/response";

function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin";
}

export default function LoginForm(): React.ReactElement {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, password }),
      });
      const body: ApiEnvelope = await res.json();
      if (body.code === 0) {
        window.location.replace(safeNext()); // 整页跳转,确保 RSC 重新取守卫状态
        return;
      }
      setError(body.message);
    } catch {
      setError("网络异常,请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-text-2">账号</span>
        <input
          type="text"
          required
          autoFocus
          autoComplete="username"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder="手机号 / 用户名 / 邮箱"
          className="rounded-sm border border-line bg-panel-2 px-3 py-2 font-mono text-sm text-text-1 outline-none placeholder:text-text-3 focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-text-2">密码</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="rounded-sm border border-line bg-panel-2 px-3 py-2 font-mono text-sm text-text-1 outline-none placeholder:text-text-3 focus:border-accent"
        />
      </label>

      {error && (
        <p
          className="rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs"
          style={{ color: "var(--red-hi)" }}
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="cursor-pointer rounded-sm bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "验证中…" : "登录控制台"}
      </button>
    </form>
  );
}
