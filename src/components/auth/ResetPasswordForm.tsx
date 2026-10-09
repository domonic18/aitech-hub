"use client";

/**
 * 重置密码表单(2026-10-09 验收反馈问题1):邮件链接携带的一次性令牌 +
 * 新密码两遍确认 → POST /api/auth/reset-password;成功引导去登录。
 */
import Link from "next/link";
import { useState } from "react";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-line-hover focus:outline-none";
const BTN =
  "w-full cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await res.json()) as { code: number; message?: string };
      if (body.code === 0) {
        setDone(true);
      } else {
        setError(body.message ?? `重置失败(${res.status})`);
      }
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <p className="rounded-sm border border-line bg-panel-2 px-3 py-2 text-center text-xs text-text-2">
          密码已重置,请使用新密码登录。
        </p>
        <Link href="/login" className={`${BTN} text-center`}>
          去登录
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="reset-password">
          新密码
        </label>
        <input
          id="reset-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          className={FIELD}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="reset-confirm">
          确认新密码
        </label>
        <input
          id="reset-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          className={FIELD}
        />
      </div>
      {error && <p className="text-xs text-red">{error}</p>}
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? "提交中…" : "重置密码"}
      </button>
    </form>
  );
}
