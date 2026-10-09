"use client";

/**
 * 前台登录表单(M21 批⑤,提案 §8):账号=手机号/用户名/邮箱 + 密码;成功
 * 整跳 next(服务端已验 startsWith("/"))。未认证邮箱账号 403 → 原地展开
 * 「重发验证邮件」(凭据已验过,同值重发;D1 注册→认证→登录)。
 */
import Link from "next/link";
import { useState } from "react";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-line-hover focus:outline-none";
const BTN =
  "w-full cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

export default function SiteLoginForm({ nextPath }: { nextPath: string }) {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResendNote(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: account.trim(), password }),
      });
      const body = (await res.json()) as {
        code: number;
        message?: string;
        data?: { role: string };
      };
      if (body.code === 0) {
        // 整跳:cookie 已设,服务端组件(含文章页门禁)全量刷新
        window.location.href = nextPath;
        return;
      }
      if (res.status === 403 && (body.message ?? "").includes("邮箱认证")) {
        setUnverified(true);
      }
      setError(body.message ?? `登录失败(${res.status})`);
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    setBusy(true);
    setResendNote(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: account.trim(), password }),
      });
      const body = (await res.json()) as { code: number; message?: string };
      setResendNote(body.message ?? "若该账号存在且未认证,验证邮件已重新发送");
    } catch {
      setResendNote("网络错误,请稍后再试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="login-account">
          账号(手机号 / 用户名 / 邮箱)
        </label>
        <input
          id="login-account"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          autoComplete="username"
          required
          className={FIELD}
        />
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="block text-xs font-medium text-text-2" htmlFor="login-password">
            密码
          </label>
          <Link href="/forgot-password" className="text-[11px] text-accent hover:underline">
            忘记密码?
          </Link>
        </div>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className={FIELD}
        />
      </div>
      {error && <p className="text-xs text-red">{error}</p>}
      {unverified && (
        <div className="rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs text-text-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void resend()}
            className="cursor-pointer font-medium text-accent hover:underline disabled:opacity-50"
          >
            重新发送验证邮件
          </button>
          {resendNote && <p className="mt-1 text-text-3">{resendNote}</p>}
        </div>
      )}
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? "登录中…" : "登录"}
      </button>
      <p className="text-center text-xs text-text-3">
        没有账号?
        <Link href="/register" className="text-accent hover:underline">
          注册
        </Link>
      </p>
    </form>
  );
}
