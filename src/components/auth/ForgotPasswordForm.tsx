"use client";

/**
 * 忘记密码表单(2026-10-09 验收反馈问题1):账号(邮箱/用户名)提交 →
 * 统一话术提示(防枚举,前端不区分存在与否)。
 */
import Link from "next/link";
import { useState } from "react";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-line-hover focus:outline-none";
const BTN =
  "w-full cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

export default function ForgotPasswordForm() {
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: account.trim() }),
      });
      const body = (await res.json()) as { code: number; message?: string };
      if (body.code === 0) {
        setNote(body.message ?? "若该账号存在,密码重置邮件已发送,请查收邮箱(含垃圾箱)");
      } else {
        setError(body.message ?? `提交失败(${res.status})`);
      }
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="forgot-account">
          账号(注册邮箱或用户名)
        </label>
        <input
          id="forgot-account"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          autoComplete="username"
          required
          className={FIELD}
        />
      </div>
      {error && <p className="text-xs text-red">{error}</p>}
      {note && (
        <p className="rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs text-text-2">
          {note}
        </p>
      )}
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? "提交中…" : "发送重置邮件"}
      </button>
      <p className="text-center text-xs text-text-3">
        想起密码了?
        <Link href="/login" className="text-accent hover:underline">
          返回登录
        </Link>
      </p>
    </form>
  );
}
