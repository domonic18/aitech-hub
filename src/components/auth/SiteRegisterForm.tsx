"use client";

/**
 * 前台注册表单(M21 批⑤,提案 §8 /register):用户名+邮箱+密码 → 注册成功
 * 即提示查收验证邮件(D1:注册→认证→登录,注册不自动登录)。
 * 回跳意图(2026-10-09 验收反馈):站内链接带 next 续传;注册成功时写入
 * sessionStorage 便签,兜底「离站点邮件链接→回来登录」丢参的一段。
 */
import Link from "next/link";
import { useState } from "react";

import { savePostLoginNext, withNext } from "@/lib/auth/next-path";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-line-hover focus:outline-none";
const BTN =
  "w-full cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";

export default function SiteRegisterForm({ nextPath }: { nextPath: string }): React.ReactElement {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password }),
      });
      const body = (await res.json()) as { code: number; message?: string };
      if (body.code === 0) {
        // 验证邮件已发(worker 异步),不自动登录;回跳意图入便签,登录页兜底恢复
        savePostLoginNext(nextPath);
        setSent(true);
        return;
      }
      setError(body.message ?? `注册失败(${res.status})`);
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-md border border-line bg-panel px-6 py-8 text-center">
        <p className="text-sm font-medium text-text-1">验证邮件已发送</p>
        <p className="text-xs text-text-2">
          请查收邮箱(含垃圾箱)完成认证,30 分钟内有效;认证后即可登录。
        </p>
        <Link href={withNext("/login", nextPath)} className="text-xs text-accent hover:underline">
          返回登录
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="reg-username">
          用户名
        </label>
        <input
          id="reg-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          className={FIELD}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="reg-email">
          邮箱(用于接收验证邮件)
        </label>
        <input
          id="reg-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className={FIELD}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="reg-password">
          密码
        </label>
        <input
          id="reg-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          className={FIELD}
        />
      </div>
      {error && <p className="text-xs text-red">{error}</p>}
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? "注册中…" : "注册"}
      </button>
      <p className="text-center text-xs text-text-3">
        已有账号?
        <Link href={withNext("/login", nextPath)} className="text-accent hover:underline">
          直接登录
        </Link>
      </p>
    </form>
  );
}
