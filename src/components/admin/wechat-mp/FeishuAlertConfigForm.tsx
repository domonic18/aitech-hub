"use client";

/**
 * 站务通知配置表单(M66):飞书自建应用凭据 + 推送开关 + 每日汇总时刻。
 * App Secret 只写不读(留空 = 保留原值);「发送测试卡片」不受启用开关限制,
 * 正是开启前的连通性探测。
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
import type { FeishuAlertConfigView } from "@/lib/channel/feishu/config";

interface ApiBody {
  code: number;
  message?: string;
  data?: { latencyMs?: number };
}

export default function FeishuAlertConfigForm({
  initial,
}: {
  initial: FeishuAlertConfigView;
}): React.ReactElement {
  const router = useRouter();
  const [appId, setAppId] = useState(initial.appId);
  const [appSecret, setAppSecret] = useState("");
  const [chatId, setChatId] = useState(initial.chatId);
  const [chatName, setChatName] = useState(initial.chatName);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [isNotifyHandoff, setIsNotifyHandoff] = useState(initial.isNotifyHandoff);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/feishu-alert-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId: appId.trim(),
          appSecret: appSecret.trim() || undefined,
          chatId: chatId.trim(),
          chatName: chatName.trim(),
          enabled,
          isNotifyHandoff,
          isNotifyDaily: initial.isNotifyDaily,
          dailySummaryHour: initial.dailySummaryHour,
        }),
      });
      const body = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || body?.code !== 0) {
        setError(body?.message ?? "保存失败,请重试");
        return;
      }
      setAppSecret("");
      setNotice("已保存");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function test(): Promise<void> {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/feishu-alert-config/test", { method: "POST" });
      const body = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || body?.code !== 0) {
        setError(body?.message ?? "发送失败,请检查应用是否已加入目标群");
        return;
      }
      setNotice(`测试卡片已发送(${body.data?.latencyMs ?? "?"}ms),请查看目标群`);
      router.refresh();
    } finally {
      setTesting(false);
    }
  }

  const statusTone = initial.enabled
    ? ("ok" as const)
    : initial.appId && initial.appSecretSet
      ? ("warn" as const)
      : ("muted" as const);

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        icon="i-send"
        title="飞书应用"
        description="自建应用凭据;应用需被拉入目标群(站务通知群)"
        status={
          <StatusChip tone={statusTone}>
            {initial.enabled
              ? "已启用"
              : initial.appId && initial.appSecretSet
                ? "已配置未启用"
                : "未配置"}
          </StatusChip>
        }
      >
        <SettingsGrid>
          <SettingsField label="App ID" htmlFor="fs-app-id" required hint="cli_ 开头">
            <input
              id="fs-app-id"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              maxLength={64}
              className={`${INPUT} font-mono`}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField
            label="App Secret"
            htmlFor="fs-app-secret"
            hint={
              initial.appSecretSet
                ? `已设置(${initial.appSecretMask ?? "已掩码"});留空 = 保留原值`
                : "飞书开放平台「凭证与基础信息」页"
            }
          >
            <input
              id="fs-app-secret"
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              maxLength={200}
              className={`${INPUT} font-mono`}
              placeholder={initial.appSecretSet ? "留空保持不变" : ""}
              autoComplete="new-password"
            />
          </SettingsField>
          <SettingsField label="群 chat_id" htmlFor="fs-chat-id" required hint="oc_ 开头">
            <input
              id="fs-chat-id"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              maxLength={100}
              className={`${INPUT} font-mono`}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField label="群名称" htmlFor="fs-chat-name" hint="仅展示用">
            <input
              id="fs-chat-name"
              value={chatName}
              onChange={(e) => setChatName(e.target.value)}
              maxLength={100}
              className={INPUT}
            />
          </SettingsField>
        </SettingsGrid>
      </SettingsSection>

      <SettingsSection
        icon="i-warning"
        title="推送策略"
        description="转人工线索即时推;每日汇总卡为后续迭代(本轮未接入)"
      >
        <SettingsGrid cols={3}>
          <SettingsField label="通道开关" hint="关闭后不再发任何站务通知">
            <label className="flex h-[34px] items-center gap-2 text-xs text-text-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              {enabled ? "启用" : "停用"}
            </label>
          </SettingsField>
          <SettingsField label="转人工即时推送">
            <label className="flex h-[34px] items-center gap-2 text-xs text-text-2">
              <input
                type="checkbox"
                checked={isNotifyHandoff}
                onChange={(e) => setIsNotifyHandoff(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              {isNotifyHandoff ? "开" : "关"}
            </label>
          </SettingsField>
          <SettingsField label="每日汇总" hint="后续迭代接入,暂不生效">
            <label className="flex h-[34px] items-center gap-2 text-xs text-text-3">
              <input type="checkbox" checked={false} disabled className="h-4 w-4" />
              未接入
            </label>
          </SettingsField>
        </SettingsGrid>
      </SettingsSection>

      <SettingsActions
        sticky
        message={
          error ? (
            <span className="text-xs text-red">{error}</span>
          ) : notice ? (
            <span className="text-xs text-accent">{notice}</span>
          ) : initial.lastTestedAt ? (
            <span className="text-xs text-text-3">
              上次测试 {initial.lastTestStatus ?? "—"} · {initial.lastTestLatencyMs ?? "?"}ms
              {initial.lastTestError ? ` · ${initial.lastTestError}` : ""}
            </span>
          ) : (
            <span className="text-xs text-text-3">建议先发一张测试卡片确认可达</span>
          )
        }
      >
        <button type="button" onClick={test} disabled={testing || busy} className={BTN_SECONDARY}>
          {testing ? "发送中…" : "发送测试卡片"}
        </button>
        <button type="button" onClick={save} disabled={busy || testing} className={BTN_PRIMARY}>
          {busy ? "保存中…" : "保存配置"}
        </button>
      </SettingsActions>
    </div>
  );
}
