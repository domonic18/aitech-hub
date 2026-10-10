"use client";

/**
 * SMTP 配置表单(M21 批⓪;2026-10-09 验收反馈问题1 重构为分区设置形态):
 * GET 脱敏视图初始化,PUT /api/email-config 保存。password 只写不读(视图只给
 * passwordSet 布尔):输入留空 = 保留原密码,首次配置(passwordSet=false)必须
 * 填写;眼睛键切换明文可见。新增「发送测试邮件」(POST /api/email-config/test,
 * 收件人留空默认发件人邮箱)。enabled 关闭时发送侧显式跳过。保存即时生效
 * (transport 按 updatedAt 换新)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  INPUT,
  SettingsActions,
  SettingsField,
  SettingsGrid,
  SettingsSection,
  StatusChip,
} from "@/components/admin/settings-controls";
import type { SmtpConfigView } from "@/lib/email/smtp-config";
import type { ApiEnvelope } from "@/lib/http/response";

function fromAddrEmail(fromAddr: string): string {
  return fromAddr.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "";
}

export default function EmailConfigForm({ initial }: { initial: SmtpConfigView }) {
  const router = useRouter();
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [fromAddr, setFromAddr] = useState(initial.fromAddr);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configured = initial.passwordSet;
  const status = enabled ? (
    <StatusChip tone="ok">已启用</StatusChip>
  ) : configured ? (
    <StatusChip tone="warn">已停用</StatusChip>
  ) : (
    <StatusChip tone="muted">未配置</StatusChip>
  );

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

  const sendTest = async (): Promise<void> => {
    setTestBusy(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/email-config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: testTo.trim() || undefined }),
      });
      const body = (await res.json()) as ApiEnvelope<{ to?: string }>;
      if (body.code !== 0) {
        setTestMsg({ ok: false, text: body.message || `HTTP ${res.status}` });
        return;
      }
      setTestMsg({
        ok: true,
        text: `测试邮件已发送${body.data?.to ? `至 ${body.data.to}` : ""},请查收`,
      });
    } catch (e) {
      setTestMsg({ ok: false, text: String(e) });
    } finally {
      setTestBusy(false);
    }
  };

  const message = error ? (
    <p className="text-[11px] leading-relaxed text-red">{error}</p>
  ) : notice ? (
    <p className="text-[11px] leading-relaxed text-accent">{notice}</p>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        icon="i-send"
        title="SMTP 服务器"
        description="事务邮件(注册验证等)经此通道发出;配置存库,保存即时生效,无需重启。"
        status={
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10px] text-text-3 md:inline">
              {initial.updatedAt
                ? `更新于 ${initial.updatedAt.replace("T", " ").slice(0, 16)}`
                : "—"}
            </span>
            {status}
          </div>
        }
      >
        <SettingsGrid>
          <SettingsField label="SMTP 主机" htmlFor="smtp-host" required>
            <input
              id="smtp-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              maxLength={255}
              placeholder="smtp.example.com"
              className={INPUT}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField
            label="端口"
            htmlFor="smtp-port"
            required
            hint={port === "465" ? "465:SSL(隐式 TLS)" : "非 465:STARTTLS(明文连升加密)"}
          >
            <input
              id="smtp-port"
              type="number"
              min={1}
              max={65535}
              step={1}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className={INPUT}
            />
          </SettingsField>
          <SettingsField label="用户名" htmlFor="smtp-user" required>
            <input
              id="smtp-user"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={255}
              className={INPUT}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField
            label="密码"
            htmlFor="smtp-pass"
            required={!configured}
            hint="只写不读:留空保留原密码;保存后不回显、不入日志。"
          >
            <div className="relative">
              <input
                id="smtp-pass"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={255}
                placeholder={configured ? "••••••••" : ""}
                className={`${INPUT} pr-10`}
                autoComplete="new-password"
              />
              <button
                type="button"
                aria-label={showPw ? "隐藏密码" : "显示密码"}
                title={showPw ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPw((v) => !v)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer ${
                  showPw ? "text-accent" : "text-text-3 hover:text-text-1"
                }`}
              >
                <svg className="ic ic-sm" aria-hidden="true">
                  <use href="#i-eye" />
                </svg>
              </button>
            </div>
          </SettingsField>
        </SettingsGrid>
        <div className="mt-4">
          <SettingsField
            label="发件人"
            htmlFor="smtp-from"
            required
            hint="收件方显示的发件人,如「一起AI <noreply@17aitech.com>」;须含邮箱地址。"
          >
            <input
              id="smtp-from"
              type="text"
              value={fromAddr}
              onChange={(e) => setFromAddr(e.target.value)}
              maxLength={255}
              placeholder="一起AI <noreply@example.com>"
              className={INPUT}
              autoComplete="off"
            />
          </SettingsField>
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-sm border border-line bg-panel-2 px-3 py-2.5 text-xs text-text-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="启用发送"
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <span>
            启用发送
            <span className="ml-1.5 text-text-3">
              关闭后注册验证邮件跳过发送,配置保留(可随时再开)
            </span>
          </span>
        </label>
      </SettingsSection>

      <SettingsActions message={message}>
        <input
          type="email"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder={`测试收件人(默认 ${fromAddrEmail(fromAddr) || "发件人邮箱"})`}
          aria-label="测试收件人"
          maxLength={255}
          className="w-56 rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-xs text-text-1 outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={testBusy}
          onClick={() => void sendTest()}
          className={BTN_SECONDARY}
        >
          {testBusy ? "发送中…" : "发送测试邮件"}
        </button>
        <button type="button" disabled={busy} onClick={() => void save()} className={BTN_PRIMARY}>
          {busy ? "保存中…" : "保存"}
        </button>
      </SettingsActions>
      {testMsg && (
        <p className={`text-[11px] ${testMsg.ok ? "text-accent" : "text-red"}`}>{testMsg.text}</p>
      )}
    </div>
  );
}
