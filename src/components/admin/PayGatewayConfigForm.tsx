"use client";

/**
 * 支付配置表单(M21 批②;与 EmailConfigForm 同款交互):GET 脱敏视图
 * 初始化,PUT /api/pay-config 保存。顶部模式三态(关闭/模拟/虎皮椒)即
 * 支付总闸(2026-10-09 拍板入后台,env 无支付开关);非 xunhu 模式下凭据
 * 字段禁用但取值保留(off = 先填后开;切走再切回 secret 不需重输)。
 * secret 只写不读:已设时回显掩码形态,输入留空 = 保留原密钥,首次启用
 * xunhu 必须填写。保存即时生效(运行时配置缓存按 updatedAt 换新)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PayGatewayConfigView, PayMode } from "@/lib/pay/gateway-config";
import type { ApiEnvelope } from "@/lib/http/response";

const field =
  "w-full rounded-sm border border-line bg-panel-2 px-2 py-1.5 text-xs text-text-1 outline-none focus:border-accent disabled:opacity-50 sm:w-80";

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

  return (
    <div className="rounded-md border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent/10 text-accent">
          <svg className="ic ic-sm" aria-hidden="true">
            <use href="#i-aim" />
          </svg>
        </span>
        <b className="text-[13px] text-text-1">支付模式与网关(总闸即此处模式)</b>
        <span className="ml-auto font-mono text-[10px] text-text-3">
          {initial.updatedAt
            ? `更新于 ${initial.updatedAt.replace("T", " ").slice(0, 19)}`
            : "未配置"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="支付模式">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] ${
              mode === o.value
                ? "border-accent bg-accent/10 text-text-1"
                : "border-line text-text-3"
            }`}
          >
            <input
              type="radio"
              name="pay-mode"
              checked={mode === o.value}
              onChange={() => setMode(o.value)}
              aria-label={o.label}
              className="accent-[var(--accent)]"
            />
            {o.label}
            <span className="text-[10px] text-text-3">{o.hint}</span>
          </label>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <Field label="商户 appId">
          <input
            type="text"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            aria-label="商户 appId"
            maxLength={64}
            autoComplete="off"
            disabled={credLocked}
            placeholder="虎皮椒商户后台查看"
            className={`mt-1 ${field}`}
          />
        </Field>
        <Field
          label={
            initial.secretSet
              ? `appSecret(留空保留原值,当前 ${initial.secretMask})`
              : "appSecret(首次启用必填)"
          }
          hint="只写不读:保存后不再回显明文,也不入日志;修改需整串重输(商户后台重置后此处同步)。"
        >
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            aria-label="appSecret"
            maxLength={128}
            autoComplete="new-password"
            disabled={credLocked}
            placeholder={initial.secretSet ? "••••••••••••••••••••" : ""}
            className={`mt-1 ${field}`}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Field
          label="API 主域(https)"
          hint="2026-10-08 实证:当前商户号仅在 api.dpweixin.com 有效。"
        >
          <input
            type="text"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            aria-label="API 主域"
            maxLength={128}
            disabled={credLocked}
            placeholder="https://api.dpweixin.com"
            className={`mt-1 ${field}`}
          />
        </Field>
        <Field
          label="API 备用域(https,可空)"
          hint="主域网络层失败时自动切换重试一次;业务报错不重试。"
        >
          <input
            type="text"
            value={apiBaseBackup}
            onChange={(e) => setApiBaseBackup(e.target.value)}
            aria-label="API 备用域"
            maxLength={128}
            disabled={credLocked}
            placeholder="https://api.xunhupay.com"
            className={`mt-1 ${field}`}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <Field
          label="异步回调 notify_url(https,可空)"
          hint="虎皮椒异步通知落此;入账唯一依据。留空时 xunhu 模式下单将被拒绝——启用前必须配置为生产域名。"
        >
          <input
            type="text"
            value={notifyUrl}
            onChange={(e) => setNotifyUrl(e.target.value)}
            aria-label="异步回调地址"
            maxLength={500}
            placeholder="https://17aitech.com/api/pay/notify"
            className={`mt-1 ${field}`}
          />
        </Field>
        <Field label="支付完成回跳 return_url(https,可空)" hint="仅前端跳转展示用,不作为入账依据。">
          <input
            type="text"
            value={returnUrl}
            onChange={(e) => setReturnUrl(e.target.value)}
            aria-label="支付完成回跳地址"
            maxLength={500}
            placeholder="https://17aitech.com/pay/{orderNo}/done"
            className={`mt-1 ${field}`}
          />
        </Field>
        <Field label="订单有效期(分钟,1-1440)" hint="pending 超时未付由对账 job 关单;默认 30。">
          <input
            type="number"
            min={1}
            max={1440}
            step={1}
            value={orderTtlMin}
            onChange={(e) => setOrderTtlMin(e.target.value)}
            aria-label="订单有效期"
            className={`mt-1 ${field} sm:w-28`}
          />
        </Field>
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
        GET/PUT /api/pay-config — 模式与凭据存 pay_gateway_config 表(admin-only;secret 不回传;env
        无支付变量)。
      </p>
    </div>
  );
}
