"use client";

/**
 * 短信通道配置表单(M65,plan M65):GET 脱敏视图初始化,PUT /api/sms-config
 * 保存。AccessKeySecret 只写不读(视图只给 accessKeySecretSet 布尔 + 掩码):
 * 输入留空 = 保留原值,首次配置必须填写。附带「发送测试短信」——真实下发一条
 * 验证码,验证 AccessKey / 签名 / 模板三者齐备(每次真实计费,页面已注明)。
 *
 * 通道是阿里云号码认证服务 PNVS 的「短信认证」:签名与模板由阿里云预置(个人
 * 实名可用),故只需填 AccessKey 与签名名;模板缺省 100001(登录/注册)。
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
import type { ApiEnvelope } from "@/lib/http/response";
import type { SmsConfigView } from "@/lib/sms/config";

export default function SmsConfigForm({ initial }: { initial: SmsConfigView }) {
  const router = useRouter();
  const [accessKeyId, setAccessKeyId] = useState(initial.accessKeyId);
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [signName, setSignName] = useState(initial.signName);
  const [templateCode, setTemplateCode] = useState(initial.templateCode);
  const [dailyLimit, setDailyLimit] = useState(String(initial.dailyLimit));
  const [enabled, setEnabled] = useState(initial.enabled);
  const [testPhone, setTestPhone] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configured = initial.accessKeySecretSet;
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
      const res = await fetch("/api/sms-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessKeyId: accessKeyId.trim(),
          ...(accessKeySecret ? { accessKeySecret } : {}),
          signName: signName.trim(),
          templateCode: templateCode.trim(),
          enabled,
          dailyLimit: Number(dailyLimit),
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setAccessKeySecret(""); // 保存成功即清空输入框,防驻留
      setNotice("已保存,登录页与发送侧即时生效(无需重启)");
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
      const res = await fetch("/api/sms-config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: testPhone.trim() }),
      });
      const body = (await res.json()) as ApiEnvelope<{ latencyMs?: number }>;
      setTestMsg(
        body.code === 0
          ? {
              ok: true,
              text: `测试短信已发送${body.data?.latencyMs ? `(耗时 ${body.data.latencyMs} ms)` : ""},请查收`,
            }
          : { ok: false, text: body.message || `HTTP ${res.status}` },
      );
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
        icon="i-comment"
        title="阿里云短信认证"
        description="手机号验证码登录/注册走号码认证服务(PNVS)短信认证;签名与模板由阿里云预置,保存即时生效。"
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
          <SettingsField
            label="AccessKeyId"
            htmlFor="sms-ak"
            required
            hint="建议使用仅授予 dypns 权限的 RAM 子账号 AccessKey。"
          >
            <input
              id="sms-ak"
              type="text"
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              maxLength={100}
              className={INPUT}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField
            label="AccessKeySecret"
            htmlFor="sms-sk"
            required={!configured}
            hint="只写不读:留空保留原密钥;保存后不回显、不入日志。"
          >
            <div className="relative">
              <input
                id="sms-sk"
                type={showSecret ? "text" : "password"}
                value={accessKeySecret}
                onChange={(e) => setAccessKeySecret(e.target.value)}
                maxLength={200}
                placeholder={configured ? (initial.accessKeySecretMask ?? "••••••••") : ""}
                className={`${INPUT} pr-10`}
                autoComplete="new-password"
              />
              <button
                type="button"
                aria-label={showSecret ? "隐藏密钥" : "显示密钥"}
                title={showSecret ? "隐藏密钥" : "显示密钥"}
                onClick={() => setShowSecret((v) => !v)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer ${
                  showSecret ? "text-accent" : "text-text-3 hover:text-text-1"
                }`}
              >
                <svg className="ic ic-sm" aria-hidden="true">
                  <use href="#i-eye" />
                </svg>
              </button>
            </div>
          </SettingsField>
          <SettingsField
            label="签名"
            htmlFor="sms-sign"
            required
            hint="PNVS 预置签名(如「恒创联众」),由阿里云签发、可能轮换,故存库不写死。"
          >
            <input
              id="sms-sign"
              type="text"
              value={signName}
              onChange={(e) => setSignName(e.target.value)}
              maxLength={50}
              className={INPUT}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField
            label="模板编码"
            htmlFor="sms-tpl"
            required
            hint="100001 登录/注册;绑定场景用 100002/100004/100005。"
          >
            <input
              id="sms-tpl"
              type="text"
              value={templateCode}
              onChange={(e) => setTemplateCode(e.target.value)}
              maxLength={50}
              className={INPUT}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField
            label="日发送预算"
            htmlFor="sms-limit"
            required
            hint="达到后熔断拒发并告警(80% 先告警);防止被刷、跑爆额度。"
          >
            <input
              id="sms-limit"
              type="number"
              min={1}
              max={10000}
              step={1}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              className={INPUT}
            />
          </SettingsField>
        </SettingsGrid>
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-sm border border-line bg-panel-2 px-3 py-2.5 text-xs text-text-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="启用短信通道"
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <span>
            启用短信通道
            <span className="ml-1.5 text-text-3">
              关闭后登录页隐藏「手机号验证码」页签,配置保留(可随时再开)
            </span>
          </span>
        </label>
      </SettingsSection>

      <SettingsActions message={message}>
        <input
          type="tel"
          value={testPhone}
          onChange={(e) => setTestPhone(e.target.value)}
          placeholder="测试手机号"
          aria-label="测试手机号"
          maxLength={11}
          inputMode="numeric"
          className="w-40 rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-xs text-text-1 outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={testBusy}
          onClick={() => void sendTest()}
          className={BTN_SECONDARY}
          title="真实下发一条验证码,按条计费"
        >
          {testBusy ? "发送中…" : "发送测试短信"}
        </button>
        <button type="button" disabled={busy} onClick={() => void save()} className={BTN_PRIMARY}>
          {busy ? "保存中…" : "保存"}
        </button>
      </SettingsActions>
      {testMsg && (
        <p className={`text-[11px] ${testMsg.ok ? "text-accent" : "text-red"}`}>{testMsg.text}</p>
      )}
      {initial.lastTestedAt && (
        <p className="text-[11px] text-text-3">
          上次连通探测:{initial.lastTestStatus === "ok" ? "成功" : "失败"}
          {initial.lastTestLatencyMs != null ? ` · ${initial.lastTestLatencyMs} ms` : ""}
          {` · ${initial.lastTestedAt.replace("T", " ").slice(0, 16)}`}
          {initial.lastTestStatus === "fail" && initial.lastTestError
            ? ` · ${initial.lastTestError}`
            : ""}
        </p>
      )}
    </div>
  );
}
