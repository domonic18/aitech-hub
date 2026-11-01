"use client";

/**
 * 前台登录表单(M21 批⑤,提案 §8):账号=手机号/用户名/邮箱 + 密码;成功
 * 整跳 next(服务端已验 startsWith("/"))。未认证邮箱账号 403 → 原地展开
 * 「重发验证邮件」(凭据已验过,同值重发;D1 注册→认证→登录)。
 * 回跳意图(2026-10-09 验收反馈):URL 无 next 时从 sessionStorage 便签兜底
 * 恢复(注册→离站点邮件验证链接→回来登录不丢目标);403 未认证也落便签;
 * 登录成功整跳前消费。注册链带 next 续传。
 *
 * M65:短信通道开启时增「密码登录 / 手机号验证码」双子页签。零 JS——radio
 * 配合 `peer-checked`(:checked 兄弟选择器),RSC 直出、无 hydration 依赖;
 * 两个面板都在 HTML 里(SEO/打印不依赖显隐)。通道关闭时退化为单面板。
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import SmsLoginForm from "@/components/auth/SmsLoginForm";
import {
  clearPostLoginNext,
  readPostLoginNext,
  savePostLoginNext,
  withNext,
} from "@/lib/auth/next-path";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-line-hover focus:outline-none";
const BTN =
  "w-full cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const TAB =
  "cursor-pointer rounded-sm border border-line bg-panel-2 px-3 py-2 text-center text-sm text-text-3 transition-colors";
const TAB_PWD =
  `${TAB} peer-checked/pwd:border-accent peer-checked/pwd:bg-panel peer-checked/pwd:text-text-1` +
  " peer-focus-visible/pwd:ring-2 peer-focus-visible/pwd:ring-accent";
const TAB_SMS =
  `${TAB} peer-checked/sms:border-accent peer-checked/sms:bg-panel peer-checked/sms:text-text-1` +
  " peer-focus-visible/sms:ring-2 peer-focus-visible/sms:ring-accent";

export default function SiteLoginForm({
  nextPath,
  smsEnabled = false,
}: {
  nextPath: string;
  smsEnabled?: boolean;
}) {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  // 整跳目标:URL next 优先(显式意图最新,同时清便签防旧值回魂);否则便签兜底
  const [target, setTarget] = useState(nextPath);

  useEffect(() => {
    if (nextPath !== "/") {
      clearPostLoginNext();
      return;
    }
    const saved = readPostLoginNext();
    if (saved) setTarget(saved);
  }, [nextPath]);

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
        // 整跳:cookie 已设,服务端组件(含文章页门禁)全量刷新;便签意图已消费
        clearPostLoginNext();
        window.location.href = target;
        return;
      }
      if (res.status === 403 && (body.message ?? "").includes("邮箱认证")) {
        setUnverified(true);
        // 即将离站点去邮箱点验证链接,落便签防回来登录时丢目标
        savePostLoginNext(target);
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

  const passwordForm = (
    <form onSubmit={submit} className="flex w-full flex-col gap-4">
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
        <Link href={withNext("/register", target)} className="text-accent hover:underline">
          注册
        </Link>
      </p>
    </form>
  );

  if (!smsEnabled) return <div className="w-full max-w-sm">{passwordForm}</div>;

  return (
    <div className="grid w-full max-w-sm grid-cols-2 gap-x-2 gap-y-5">
      {/* 零 JS 页签:两个 radio 在 DOM 中先于 label 与面板,peer-checked 走兄弟选择器 */}
      <input
        id="login-tab-pwd"
        type="radio"
        name="login-tab"
        defaultChecked
        className="peer/pwd sr-only"
      />
      <input id="login-tab-sms" type="radio" name="login-tab" className="peer/sms sr-only" />
      <label htmlFor="login-tab-pwd" className={TAB_PWD}>
        密码登录
      </label>
      <label htmlFor="login-tab-sms" className={TAB_SMS}>
        手机号验证码
      </label>
      <div className="col-span-2 hidden peer-checked/pwd:block" role="region" aria-label="密码登录">
        {passwordForm}
      </div>
      <div
        className="col-span-2 hidden peer-checked/sms:block"
        role="region"
        aria-label="手机号验证码登录"
      >
        <SmsLoginForm target={target} />
      </div>
    </div>
  );
}
