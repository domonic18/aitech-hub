"use client";

/**
 * 飞书免登配置表单(M29 批①,形态随 EmailConfigForm):凭证分区(AppID/
 * AppSecret 只写不读/enabled 开关)+ 连通性探针;绑定分区 = 密码会话内自绑
 * (在飞书工作台内打开本页 → h5sdk 取授权码 → POST /api/admin/feishu/bind)
 * 与自解绑。非飞书环境点绑定给出提示(fail-closed,不报错刷屏)。
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
import type { FeishuConfigView } from "@/lib/auth/feishu-config";
import type { FeishuBindingView } from "@/lib/auth/feishu-binding";
import type { ApiEnvelope } from "@/lib/http/response";
import { isFeishuWebview, requestFeishuAuthCode } from "@/lib/feishu/h5";

function fmtTime(iso: string | null): string {
  return iso ? iso.replace("T", " ").slice(0, 16) : "—";
}

export default function FeishuConfigForm({
  initialConfig,
  initialBinding,
}: {
  initialConfig: FeishuConfigView;
  initialBinding: FeishuBindingView | null;
}) {
  const router = useRouter();
  const [appId, setAppId] = useState(initialConfig.appId);
  const [appSecret, setAppSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [bindBusy, setBindBusy] = useState(false);
  const [bindMsg, setBindMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const secretSet = Boolean(initialConfig.appSecretMask);
  const status = enabled ? (
    <StatusChip tone="ok">已启用</StatusChip>
  ) : secretSet ? (
    <StatusChip tone="warn">已停用</StatusChip>
  ) : (
    <StatusChip tone="muted">未配置</StatusChip>
  );

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/feishu/config/", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId, ...(appSecret ? { appSecret } : {}), enabled }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setAppSecret(""); // 保存成功即清空输入框,防驻留
      setNotice("已保存,即时生效(无需重启)");
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
      const res = await fetch("/api/admin/feishu/test/", { method: "POST" });
      const body = (await res.json()) as ApiEnvelope<{ latencyMs?: number }>;
      setTestMsg({
        ok: body.code === 0,
        text: body.message || `HTTP ${res.status}`,
      });
      router.refresh(); // lastTest 四件套落库后同步页脚「上次探测」行
    } catch (e) {
      setTestMsg({ ok: false, text: String(e) });
    } finally {
      setTestBusy(false);
    }
  };

  /** 免登自绑:取授权码 → 服务端兑换身份落白名单;任一步失败回落提示 */
  const bind = async (): Promise<void> => {
    setBindBusy(true);
    setBindMsg(null);
    try {
      if (!isFeishuWebview()) {
        setBindMsg({
          ok: false,
          text: "当前不是飞书环境:请在飞书工作台内打开本页完成绑定(PC 浏览器暂不支持)",
        });
        return;
      }
      const code = await requestFeishuAuthCode();
      const res = await fetch("/api/admin/feishu/bind/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setBindMsg({ ok: false, text: body.message || `HTTP ${res.status}` });
        return;
      }
      setBindMsg({ ok: true, text: "绑定成功,兑换通道按开关生效" });
      router.refresh();
    } catch (e) {
      setBindMsg({ ok: false, text: `绑定失败:${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBindBusy(false);
    }
  };

  const unbind = async (): Promise<void> => {
    setBindBusy(true);
    setBindMsg(null);
    try {
      const res = await fetch("/api/admin/feishu/bind/", { method: "DELETE" });
      const body = (await res.json()) as ApiEnvelope;
      setBindMsg({ ok: body.code === 0, text: body.message || `HTTP ${res.status}` });
      router.refresh();
    } catch (e) {
      setBindMsg({ ok: false, text: String(e) });
    } finally {
      setBindBusy(false);
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
        icon="i-scan"
        title="飞书应用凭证"
        description="自建应用凭证存库(不入 env);绑定/签名只要求凭证齐,「启用」控制兑换通道。"
        status={
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-[10px] text-text-3 md:inline">
              更新于 {fmtTime(initialConfig.updatedAt)}
            </span>
            {status}
          </div>
        }
      >
        <SettingsGrid>
          <SettingsField label="App ID" htmlFor="feishu-appid" required>
            <input
              id="feishu-appid"
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              maxLength={50}
              placeholder="cli_xxxxxxxx"
              className={INPUT}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField
            label="App Secret"
            htmlFor="feishu-secret"
            required={!secretSet}
            hint="只写不读:留空保留原密钥;AES-256-GCM 入库,保存后不回显、不入日志。"
          >
            <div className="relative">
              <input
                id="feishu-secret"
                type={showSecret ? "text" : "password"}
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                maxLength={400}
                placeholder={initialConfig.appSecretMask ?? ""}
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
        </SettingsGrid>
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-sm border border-line bg-panel-2 px-3 py-2.5 text-xs text-text-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            aria-label="启用免登"
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <span>
            启用免登
            <span className="ml-1.5 text-text-3">
              关闭后工作台免登回落密码表单,配置与绑定关系保留(可随时再开)
            </span>
          </span>
        </label>
        {initialConfig.lastTestStatus ? (
          <p className="mt-3 text-[11px] leading-relaxed text-text-3">
            上次探测:{fmtTime(initialConfig.lastTestedAt)} ·{" "}
            {initialConfig.lastTestStatus === "ok" ? (
              <span className="text-accent">
                连通正常({initialConfig.lastTestLatencyMs ?? "?"}ms)
              </span>
            ) : (
              <span className="text-red">{initialConfig.lastTestError ?? "失败"}</span>
            )}
          </p>
        ) : null}
        {testMsg ? (
          <p className={`mt-2 text-[11px] ${testMsg.ok ? "text-accent" : "text-red"}`}>
            {testMsg.text}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsActions message={message}>
        <button
          type="button"
          disabled={testBusy}
          onClick={() => void sendTest()}
          className={BTN_SECONDARY}
        >
          {testBusy ? "探测中…" : "测试连接"}
        </button>
        <button type="button" disabled={busy} onClick={() => void save()} className={BTN_PRIMARY}>
          {busy ? "保存中…" : "保存"}
        </button>
      </SettingsActions>

      <SettingsSection
        icon="i-user"
        title="账号绑定"
        description="绑定后可在飞书工作台免登进入后台;一账号绑一飞书身份,换绑直接重做即可。"
        status={
          initialBinding ? (
            <StatusChip tone="ok">
              已绑定{initialBinding.feishuName ? `:${initialBinding.feishuName}` : ""}
            </StatusChip>
          ) : (
            <StatusChip tone="muted">未绑定</StatusChip>
          )
        }
      >
        {initialBinding ? (
          <p className="text-[11px] leading-relaxed text-text-3">
            绑定时间 {fmtTime(initialBinding.boundAt)} · openId {initialBinding.openId.slice(0, 12)}
            …
          </p>
        ) : (
          <p className="text-[11px] leading-relaxed text-text-3">
            未绑定:在飞书工作台内打开本页,点「一键绑定」完成(需应用具备 union ID 权限)。
          </p>
        )}
        {bindMsg ? (
          <p className={`mt-2 text-[11px] ${bindMsg.ok ? "text-accent" : "text-red"}`}>
            {bindMsg.text}
          </p>
        ) : null}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={bindBusy}
            onClick={() => void bind()}
            className={BTN_PRIMARY}
          >
            {bindBusy ? "处理中…" : initialBinding ? "重新绑定" : "一键绑定"}
          </button>
          {initialBinding ? (
            <button
              type="button"
              disabled={bindBusy}
              onClick={() => void unbind()}
              className={BTN_SECONDARY}
            >
              解绑
            </button>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}
