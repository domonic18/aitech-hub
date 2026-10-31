"use client";

/**
 * 手机号验证码登录/注册(M65,plan M65):登录与注册合一——号码已存在即登录,
 * 不存在则自动建号(服务端决定,前端不做分支提示)。验证码由阿里云 PNVS
 * 托管,5 分钟有效、60 秒可重发,故按钮带本地倒计时(服务端另有频控兜底)。
 *
 * 合规:自动建号场景需显式同意用户协议与隐私政策,勾选框不预选。
 * 回跳意图与密码登录同源(sessionStorage 便签兜底),成功后整跳。
 */
import Link from "next/link";
import { useState } from "react";

import { clearPostLoginNext } from "@/lib/auth/next-path";
import { PHONE_RE } from "@/lib/auth/rules";

import { useSmsCountdown } from "./use-sms-countdown";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-line-hover focus:outline-none";
const BTN =
  "w-full cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const BTN_CODE =
  "shrink-0 cursor-pointer rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs text-text-2 transition-colors hover:border-line-hover hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50";

export default function SmsLoginForm({ target }: { target: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { countdown, start: startCountdown } = useSmsCountdown();

  async function sendCode(): Promise<void> {
    if (!PHONE_RE.test(phone.trim())) {
      setError("请输入正确的 11 位手机号");
      return;
    }
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/sms-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const body = (await res.json()) as { code: number; message?: string };
      if (body.code === 0) {
        setNotice(body.message ?? "验证码已发送,5 分钟内有效");
        startCountdown();
      } else {
        setError(body.message ?? `发送失败(${res.status})`);
      }
    } catch {
      setError("网络错误,请重试");
    } finally {
      setSending(false);
    }
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!agreed) {
      setError("请先阅读并同意用户协议与隐私政策");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sms-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim(), agreed: true }),
      });
      const body = (await res.json()) as { code: number; message?: string };
      if (body.code === 0) {
        clearPostLoginNext();
        window.location.href = target;
        return;
      }
      setError(body.message ?? `登录失败(${res.status})`);
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  const canSend = !sending && countdown === 0 && PHONE_RE.test(phone.trim());

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="sms-phone">
          手机号
        </label>
        <input
          id="sms-phone"
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
          autoComplete="tel"
          maxLength={11}
          required
          className={FIELD}
          placeholder="11 位手机号"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="sms-code">
          验证码
        </label>
        <div className="flex gap-2">
          <input
            id="sms-code"
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
            autoComplete="one-time-code"
            maxLength={8}
            required
            className={FIELD}
            placeholder="6 位数字"
          />
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void sendCode()}
            className={BTN_CODE}
          >
            {countdown > 0 ? `${countdown}s` : sending ? "发送中…" : "获取验证码"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-text-3">验证码 5 分钟内有效;首次登录将自动创建账号。</p>
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-text-2">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
        />
        <span>
          我已阅读并同意
          <Link href="/agreement/" className="mx-0.5 text-accent hover:underline">
            用户协议
          </Link>
          与
          <Link href="/privacy/" className="mx-0.5 text-accent hover:underline">
            隐私政策
          </Link>
          (含短信服务由第三方服务商处理手机号)
        </span>
      </label>
      {error && <p className="text-xs text-red">{error}</p>}
      {notice && !error && <p className="text-xs text-accent">{notice}</p>}
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? "登录中…" : "登录 / 注册"}
      </button>
    </form>
  );
}
