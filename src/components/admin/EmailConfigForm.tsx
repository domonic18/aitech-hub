"use client";

/**
 * SMTP 配置表单(M21 批⓪):GET 脱敏视图初始化,PUT /api/email-config 保存。
 * password 只写不读(视图只给 passwordSet 布尔):输入留空 = 保留原密码,
 * 首次配置(passwordSet=false)必须填写。enabled 关闭时发送侧显式跳过
 * (可存配置暂停发信)。保存即时生效(transport 按 updatedAt 换新)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { SmtpConfigView } from "@/lib/email/smtp-config";
import type { ApiEnvelope } from "@/lib/http/response";

const field =
  "w-full rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-xs text-text-1 outline-none focus:border-accent sm:w-72";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block text-[11px] text-text-3">
      {label}
      {children}
      {hint ? <span className="mt-1 block leading-relaxed">{hint}</span> : null}
    </label>
  );
}

export default function EmailConfigForm({ initial }: { initial: SmtpConfigView }) {
  const router = useRouter();
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState("");
  const [fromAddr, setFromAddr] = useState(initial.fromAddr);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/email-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host,
          port: Number(port),
          username,
          ...(password ? { password } : {}),
          fromAddr,
          enabled,
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setPassword(""); // 保存成功即清空输入框,防驻留
      setNotice("已保存,发送侧即时生效(无需重启)");
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent/10 text-accent">
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-send" />
          </svg>
        </span>
        <b className="text-[13px] text-text-1">SMTP 服务器</b>
        <span className="ml-auto font-mono text-[10px] text-text-3">
          {initial.updatedAt
            ? `更新于 ${initial.updatedAt.replace("T", " ").slice(0, 19)}`
            : "未配置"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Field label="SMTP 主机" hint="如 smtp.exmail.qq.com、smtpdm.aliyun.com">
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            aria-label="SMTP 主机"
            maxLength={255}
            placeholder="smtp.example.com"
            className={`mt-1 ${field}`}
          />
        </Field>
        <Field label="端口(465 走 SSL,其余 STARTTLS)">
          <input
            type="number"
            min={1}
            max={65535}
            step={1}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            aria-label="SMTP 端口"
            className={`mt-1 ${field} sm:w-28`}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Field label="用户名">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-label="SMTP 用户名"
            maxLength={255}
            autoComplete="off"
            className={`mt-1 ${field}`}
          />
        </Field>
        <Field
          label={initial.passwordSet ? "密码(留空保留原密码)" : "密码(必填)"}
          hint="只写不读:保存后不再回显,也不入日志。"
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="SMTP 密码"
            maxLength={255}
            autoComplete="new-password"
            placeholder={initial.passwordSet ? "••••••••" : ""}
            className={`mt-1 ${field}`}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-col gap-3">
        <Field
          label="发件人(须含邮箱地址)"
          hint='如 "一起AI <noreply@17aitech.com>",收件方显示的发件人。'
        >
          <input
            type="text"
            value={fromAddr}
            onChange={(e) => setFromAddr(e.target.value)}
            aria-label="发件人"
            maxLength={255}
            className={`mt-1 ${field}`}
          />
        </Field>
        <label className="flex items-center gap-2 text-[11px] text-text-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="启用发送"
            className="accent-[var(--accent)]"
          />
          启用发送(关闭后注册验证邮件跳过发送,配置保留)
        </label>
      </div>

      {error && <p className="mt-2 font-mono text-[11px] text-red">{error}</p>}
      {notice && <p className="mt-2 font-mono text-[11px] text-text-2">{notice}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="cursor-pointer rounded-sm bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        GET/PUT /api/email-config — 配置存 email_config 表(admin-only;password 不回传)。
      </p>
    </div>
  );
}
