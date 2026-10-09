"use client";

/**
 * 支付配置表单(M21 批②;2026-10-09 布局重构对齐设置页分区形态):
 * GET 脱敏视图初始化,PUT /api/pay-config 保存。「支付模式」即支付总闸
 * (2026-10-09 拍板入后台,env 无支付开关),三态瓦片单选;非 xunhu 模式下
 * 凭据字段禁用但取值保留(off = 先填后开;切走再切回 secret 不需重输)。
 * secret 只写不读:已设时回显掩码形态,输入留空 = 保留原密钥,首次启用
 * xunhu 必须填写(眼睛键仅切换本次输入的明文可见,不回显原值)。保存即时
 * 生效(运行时配置缓存按 updatedAt 换新)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  BTN_PRIMARY,
  INPUT,
  SettingsActions,
  SettingsField,
  SettingsGrid,
  SettingsSection,
  StatusChip,
} from "@/components/admin/settings-controls";
import type { PayGatewayConfigView, PayMode } from "@/lib/pay/gateway-config";
import type { ApiEnvelope } from "@/lib/http/response";

const MODE_OPTIONS: { value: PayMode; label: string; hint: string }[] = [
  { value: "off", label: "关闭", hint: "收银台入口关闭,下单拒绝;已配置保留" },
  { value: "mock", label: "模拟(仅开发)", hint: "全链路模拟不出网,仅本地/开发环境可选" },
  { value: "xunhu", label: "虎皮椒", hint: "真实收款;须下方凭据与回调地址齐备" },
];

export default function PayGatewayConfigForm({
  initial,
  allowMock,
}: {
  initial: PayGatewayConfigView;
  allowMock: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<PayMode>(initial.mode);
  const [appId, setAppId] = useState(initial.appId);
  const [appSecret, setAppSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [apiBase, setApiBase] = useState(initial.apiBase);
  const [apiBaseBackup, setApiBaseBackup] = useState(initial.apiBaseBackup);
  const [notifyUrl, setNotifyUrl] = useState(initial.notifyUrl);
  const [returnUrl, setReturnUrl] = useState(initial.returnUrl);
  const [orderTtlMin, setOrderTtlMin] = useState(String(initial.orderTtlMin));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const credLocked = mode !== "xunhu"; // 凭据仅 xunhu 模式可编辑(取值保留,不丢已填内容)

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pay-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          appId,
          ...(appSecret ? { appSecret } : {}),
          apiBase,
          apiBaseBackup: apiBaseBackup || undefined,
          notifyUrl,
          returnUrl,
          orderTtlMin: Number(orderTtlMin),
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setAppSecret(""); // 保存成功即清空输入框,防驻留
      setNotice("已保存,支付模式即时生效(无需重启)");
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const options = MODE_OPTIONS.filter((o) => o.value !== "mock" || allowMock);

  const updated = (
    <span className="hidden font-mono text-[10px] text-text-3 md:inline">
      {initial.updatedAt ? `更新于 ${initial.updatedAt.replace("T", " ").slice(0, 16)}` : "—"}
    </span>
  );

  const message = error ? (
    <p className="text-[11px] leading-relaxed text-red">{error}</p>
  ) : notice ? (
    <p className="text-[11px] leading-relaxed text-accent">{notice}</p>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        icon="i-aim"
        title="支付模式(总闸)"
        description="站点收款总开关:关闭即全站无任何收款动作;保存即时生效,无需重启。"
        status={
          <div className="flex items-center gap-2">
            {updated}
            {mode === "xunhu" ? (
              <StatusChip tone="ok">虎皮椒</StatusChip>
            ) : mode === "mock" ? (
              <StatusChip tone="warn">模拟模式</StatusChip>
            ) : (
              <StatusChip tone="muted">已关闭</StatusChip>
            )}
          </div>
        }
      >
        <div
          role="radiogroup"
          aria-label="支付模式"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {options.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer flex-col gap-1 rounded-sm border px-3 py-2.5 transition-colors ${
                mode === o.value
                  ? "border-accent bg-accent/10"
                  : "border-line hover:border-line-hover"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="pay-mode"
                  checked={mode === o.value}
                  onChange={() => setMode(o.value)}
                  aria-label={o.label}
                  className="sr-only"
                />
                <b className={`text-xs ${mode === o.value ? "text-text-1" : "text-text-2"}`}>
                  {o.label}
                </b>
              </span>
              <span className="text-[11px] leading-relaxed text-text-3">{o.hint}</span>
            </label>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        icon="i-key"
        title="虎皮椒网关凭据"
        description="凭据存 pay_gateway_config 表,env 无支付变量;secret 只写不读,不入日志。"
        status={
          credLocked ? (
            <StatusChip tone="muted">凭据锁定</StatusChip>
          ) : notifyUrl.trim() === "" ? (
            <StatusChip tone="warn">缺回调地址</StatusChip>
          ) : (
            <StatusChip tone="ok">就绪</StatusChip>
          )
        }
      >
        <SettingsGrid>
          <SettingsField label="商户 appId" htmlFor="pay-appid">
            <input
              id="pay-appid"
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              aria-label="商户 appId"
              maxLength={64}
              autoComplete="off"
              disabled={credLocked}
              placeholder="虎皮椒商户后台查看"
              className={INPUT}
            />
          </SettingsField>
          <SettingsField
            label="appSecret"
            htmlFor="pay-secret"
            required={!initial.secretSet}
            hint="只写不读:留空保留原值,保存后不回显、不入日志;商户后台重置后此处整串重输。"
          >
            <div className="relative">
              <input
                id="pay-secret"
                type={showSecret ? "text" : "password"}
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                aria-label="appSecret"
                maxLength={128}
                autoComplete="new-password"
                disabled={credLocked}
                placeholder={
                  initial.secretSet ? `留空保留原值(当前 ${initial.secretMask})` : "首次启用必填"
                }
                className={`${INPUT} pr-10`}
              />
              <button
                type="button"
                aria-label={showSecret ? "隐藏明文" : "显示明文"}
                title={showSecret ? "隐藏明文" : "显示明文"}
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
        </SettingsGrid>

        <div className="mt-4">
          <SettingsGrid>
            <SettingsField
              label="API 主域(https)"
              htmlFor="pay-apibase"
              hint="2026-10-08 实证:当前商户号仅在 api.dpweixin.com 有效。"
            >
              <input
                id="pay-apibase"
                type="text"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                aria-label="API 主域"
                maxLength={128}
                disabled={credLocked}
                placeholder="https://api.dpweixin.com"
                className={INPUT}
              />
            </SettingsField>
            <SettingsField
              label="API 备用域(https,可空)"
              htmlFor="pay-apibackup"
              hint="主域网络层失败时自动切换重试一次;业务报错不重试。"
            >
              <input
                id="pay-apibackup"
                type="text"
                value={apiBaseBackup}
                onChange={(e) => setApiBaseBackup(e.target.value)}
                aria-label="API 备用域"
                maxLength={128}
                disabled={credLocked}
                placeholder="https://api.xunhupay.com"
                className={INPUT}
              />
            </SettingsField>
          </SettingsGrid>
        </div>

        <div className="mt-4">
          <SettingsField
            label="异步回调 notify_url(https,可空)"
            htmlFor="pay-notify"
            hint="虎皮椒异步通知落此,入账唯一依据;留空时 xunhu 模式下单将被拒绝——启用前必须配置为生产域名。"
          >
            <input
              id="pay-notify"
              type="text"
              value={notifyUrl}
              onChange={(e) => setNotifyUrl(e.target.value)}
              aria-label="异步回调地址"
              maxLength={500}
              placeholder="https://17aitech.com/api/pay/notify"
              className={INPUT}
            />
          </SettingsField>
        </div>

        <div className="mt-4">
          <SettingsGrid>
            <SettingsField
              label="支付完成回跳 return_url(https,可空)"
              htmlFor="pay-return"
              hint="仅前端跳转展示用,不作为入账依据。"
            >
              <input
                id="pay-return"
                type="text"
                value={returnUrl}
                onChange={(e) => setReturnUrl(e.target.value)}
                aria-label="支付完成回跳地址"
                maxLength={500}
                placeholder="https://17aitech.com/pay/{orderNo}/done"
                className={INPUT}
              />
            </SettingsField>
            <SettingsField
              label="订单有效期(分钟,1-1440)"
              htmlFor="pay-ttl"
              hint="pending 超时未付由对账 job 关单;默认 30。"
            >
              <input
                id="pay-ttl"
                type="number"
                min={1}
                max={1440}
                step={1}
                value={orderTtlMin}
                onChange={(e) => setOrderTtlMin(e.target.value)}
                aria-label="订单有效期"
                className={INPUT}
              />
            </SettingsField>
          </SettingsGrid>
        </div>
      </SettingsSection>

      <SettingsActions message={message} sticky>
        <button type="button" disabled={busy} onClick={() => void save()} className={BTN_PRIMARY}>
          {busy ? "保存中…" : "保存"}
        </button>
      </SettingsActions>
      <p className="font-mono text-[11px] text-text-3">
        GET/PUT /api/pay-config — 模式与凭据存 pay_gateway_config 表(admin-only;secret 不回传;env
        无支付变量)。
      </p>
    </div>
  );
}
