"use client";

/**
 * 手机号绑定 / 换绑表单(M65 P1,arch/05-services §3.4)。
 *
 * 两条路径:
 * - 未绑定 → 直接发码到新号(PNVS 100004),验码即绑定;
 * - 已绑定 → **两步**:先验证当前号(100005,号码由服务端从会话取,本表单
 *   不传),通过后再填新号(100002)。两步之间的放行标记在服务端(10 分钟),
 *   前端切换只是体验,跳过第一步会得到 409。
 *
 * 成功后整页刷新,由 RSC 重新取 profile 决定走哪条路径。
 */
import Link from "next/link";
import { useState } from "react";

import { PHONE_RE } from "@/lib/auth/rules";

import { useSmsCountdown } from "@/components/auth/use-sms-countdown";
import type { PhoneScene } from "@/lib/sms/scenes";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 focus:border-line-hover focus:outline-none";
const BTN =
  "cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const BTN_CODE =
  "shrink-0 cursor-pointer rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs text-text-2 transition-colors hover:border-line-hover hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50";

type Step = PhoneScene;

interface ApiBody {
  code: number;
  message?: string;
  data?: { step?: string };
}

export default function PhoneForm({
  maskedPhone,
}: {
  maskedPhone: string | null;
}): React.ReactElement {
  const [step, setStep] = useState<Step>(maskedPhone ? "rebind_old" : "bind");
  const [newPhone, setNewPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { countdown, start: startCountdown } = useSmsCountdown();

  const needsNewPhone = step !== "rebind_old";
  const phoneReady = !needsNewPhone || PHONE_RE.test(newPhone.trim());
  const canSend = !sending && countdown === 0 && phoneReady;

  async function sendCode(): Promise<void> {
    if (!phoneReady) {
      setError("请输入正确的 11 位手机号");
      return;
    }
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/account/phone/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scene: step,
          phone: needsNewPhone ? newPhone.trim() : undefined,
        }),
      });
      const body = (await res.json()) as ApiBody;
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
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/phone/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scene: step,
          phone: needsNewPhone ? newPhone.trim() : undefined,
          code: code.trim(),
        }),
      });
      const body = (await res.json()) as ApiBody;
      if (body.code !== 0) {
        setError(body.message ?? `提交失败(${res.status})`);
        return;
      }
      if (step === "rebind_old") {
        // 第一步通过:服务端已置 10 分钟放行标记,进入填新号
        setStep("rebind_new");
        setCode("");
        setNewPhone("");
        setNotice(body.message ?? "当前手机号验证通过,请继续绑定新手机号");
        return;
      }
      setNotice(body.message ?? "手机号已更新");
      setTimeout(() => window.location.reload(), 700);
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {maskedPhone && (
        <p className="text-xs text-text-2">
          当前绑定:<span className="font-mono text-text-1">{maskedPhone}</span>
          {step === "rebind_new" && (
            <span className="ml-2 text-text-3">(已通过验证,请填写新手机号)</span>
          )}
        </p>
      )}

      {needsNewPhone && (
        <div>
          <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="acc-phone-new">
            {maskedPhone ? "新手机号" : "手机号"}
          </label>
          <input
            id="acc-phone-new"
            type="tel"
            inputMode="numeric"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
            autoComplete="tel"
            maxLength={11}
            required
            className={FIELD}
            placeholder="11 位手机号"
          />
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="acc-phone-code">
          验证码
        </label>
        <div className="flex gap-2">
          <input
            id="acc-phone-code"
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
        <p className="mt-1 text-[11px] text-text-3">
          {needsNewPhone
            ? "验证码将发送至新手机号,5 分钟内有效。"
            : "验证码将发送至当前绑定的手机号,用于确认身份。"}
        </p>
      </div>

      <p className="text-[11px] leading-relaxed text-text-3">
        绑定手机号即表示同意
        <Link href="/privacy/" className="mx-0.5 text-accent hover:underline">
          隐私政策
        </Link>
        中关于短信服务由第三方服务商处理手机号的说明。
      </p>

      {error && <p className="text-xs text-red">{error}</p>}
      {notice && !error && <p className="text-xs text-accent">{notice}</p>}

      <div>
        <button type="submit" disabled={busy || !phoneReady} className={BTN}>
          {busy ? "提交中…" : step === "rebind_old" ? "验证当前手机号" : "确认绑定"}
        </button>
      </div>
    </form>
  );
}
