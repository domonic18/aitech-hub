"use client";

/**
 * 公众号接入配置表单(M66):服务器配置 + 话术 + 转人工词 + 每日上限。
 * - EncodingAESKey 只写不读:留空 = 保留原值,首录必填(服务端开启时校验)。
 * - 「本地自检」只验证本站 Token/AESKey 的签名与加解密链路,不能反查
 *   公众号后台填的是否一致——文案里已明说,避免假阳性。
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
import type { WechatMpConfigView } from "@/lib/channel/wechat-mp/config";

interface ApiBody {
  code: number;
  message?: string;
  data?: { latencyMs?: number };
}

function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export default function WechatMpConfigForm({
  initial,
}: {
  initial: WechatMpConfigView;
}): React.ReactElement {
  const router = useRouter();
  const [token, setToken] = useState(initial.token);
  const [aesKey, setAesKey] = useState("");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [greetingText, setGreetingText] = useState(initial.greetingText);
  const [fallbackText, setFallbackText] = useState(initial.fallbackText);
  const [handoffText, setHandoffText] = useState(initial.handoffText);
  const [handoffKeywords, setHandoffKeywords] = useState(initial.handoffKeywords.join(", "));
  const [dailyAnswerLimit, setDailyAnswerLimit] = useState(String(initial.dailyAnswerLimit));
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/wechat-mp-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          encodingAESKey: aesKey.trim() || undefined,
          enabled,
          greetingText,
          fallbackText,
          handoffText,
          handoffKeywords: splitKeywords(handoffKeywords),
          dailyAnswerLimit: Number.parseInt(dailyAnswerLimit, 10) || 1,
        }),
      });
      const body = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || body?.code !== 0) {
        setError(body?.message ?? "保存失败,请重试");
        return;
      }
      setAesKey("");
      setNotice("已保存");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function probe(): Promise<void> {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/wechat-mp-config/test", { method: "POST" });
      const body = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || body?.code !== 0) {
        setError(body?.message ?? "自检失败");
        return;
      }
      setNotice(
        `自检通过(${body.data?.latencyMs ?? "?"}ms):本站签名与加解密链路一致;` +
          "公众号后台的 Token/AESKey 是否填对需在真实消息里验证",
      );
      router.refresh();
    } finally {
      setTesting(false);
    }
  }

  const statusTone = initial.enabled
    ? ("ok" as const)
    : initial.token
      ? ("warn" as const)
      : ("muted" as const);

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        icon="i-setting"
        title="服务器配置"
        description="与公众号后台「服务器配置」逐字一致;加密方式建议安全模式"
        status={
          <StatusChip tone={statusTone}>
            {initial.enabled ? "已启用" : initial.token ? "已配置未启用" : "未配置"}
          </StatusChip>
        }
      >
        <SettingsGrid>
          <SettingsField
            label="Token"
            htmlFor="mp-token"
            required
            hint="3-32 位字母/数字/下划线/连字符,与公众号后台一致"
          >
            <input
              id="mp-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              maxLength={32}
              className={`${INPUT} font-mono`}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField
            label="EncodingAESKey"
            htmlFor="mp-aes"
            hint={
              initial.encodingAesKeySet
                ? `已设置(${initial.encodingAesKeyMask ?? "已掩码"});留空 = 保留原值`
                : "43 位,公众号后台「随机生成」后复制过来"
            }
          >
            <input
              id="mp-aes"
              value={aesKey}
              onChange={(e) => setAesKey(e.target.value)}
              maxLength={64}
              className={`${INPUT} font-mono`}
              placeholder={initial.encodingAesKeySet ? "留空保持不变" : ""}
              autoComplete="off"
            />
          </SettingsField>
          <SettingsField label="AppID(只读)" hint="与「公众号分发」共用,修改请去分发中心">
            <input
              value={initial.appId || "未配置"}
              readOnly
              className={`${INPUT} font-mono opacity-70`}
            />
          </SettingsField>
          <SettingsField label="通道开关" hint="关闭后端点直接回 success,不处理消息">
            <label className="flex h-[34px] items-center gap-2 text-xs text-text-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              {enabled ? "启用入站处理" : "停用"}
            </label>
          </SettingsField>
        </SettingsGrid>
      </SettingsSection>

      <SettingsSection
        icon="i-comment"
        title="话术"
        description="留空即用代码默认话术;检索无命中不发 LLM(不胡乱回答)"
      >
        <SettingsGrid cols={3}>
          <SettingsField label="关注欢迎语" htmlFor="mp-greeting" hint="关注事件回执,≤500 字">
            <textarea
              id="mp-greeting"
              value={greetingText}
              onChange={(e) => setGreetingText(e.target.value)}
              maxLength={500}
              rows={3}
              className={INPUT}
              placeholder="默认:欢迎语…"
            />
          </SettingsField>
          <SettingsField label="无命中话术" htmlFor="mp-fallback" hint="站内检索 0 条时回这句">
            <textarea
              id="mp-fallback"
              value={fallbackText}
              onChange={(e) => setFallbackText(e.target.value)}
              maxLength={500}
              rows={3}
              className={INPUT}
              placeholder="默认:没找到相关站内内容…"
            />
          </SettingsField>
          <SettingsField label="转人工回执" htmlFor="mp-handoff" hint="命中转人工词后的确认话术">
            <textarea
              id="mp-handoff"
              value={handoffText}
              onChange={(e) => setHandoffText(e.target.value)}
              maxLength={500}
              rows={3}
              className={INPUT}
              placeholder="默认:已转人工…"
            />
          </SettingsField>
        </SettingsGrid>
        <div className="mt-4">
          <SettingsField
            label="转人工关键词"
            htmlFor="mp-handoff-kw"
            hint="逗号或换行分隔,最多 20 个;命中后落转人工线索并推送飞书站务群"
          >
            <textarea
              id="mp-handoff-kw"
              value={handoffKeywords}
              onChange={(e) => setHandoffKeywords(e.target.value)}
              rows={2}
              className={INPUT}
              placeholder="人工, 客服, 投诉"
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection
        icon="i-cloudserver"
        title="用量保护"
        description="每日 LLM 答案上限,超限后一律回无命中话术"
      >
        <SettingsGrid cols={3}>
          <SettingsField label="每日答案上限(条)" htmlFor="mp-limit" hint="1-10000">
            <input
              id="mp-limit"
              type="number"
              min={1}
              max={10000}
              value={dailyAnswerLimit}
              onChange={(e) => setDailyAnswerLimit(e.target.value)}
              className={`${INPUT} font-mono`}
            />
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
              上次自检 {initial.lastTestStatus ?? "—"} · {initial.lastTestLatencyMs ?? "?"}ms
              {initial.lastTestError ? ` · ${initial.lastTestError}` : ""}
            </span>
          ) : (
            <span className="text-xs text-text-3">保存后建议跑一次本地自检</span>
          )
        }
      >
        <button type="button" onClick={probe} disabled={testing || busy} className={BTN_SECONDARY}>
          {testing ? "自检中…" : "本地自检"}
        </button>
        <button type="button" onClick={save} disabled={busy || testing} className={BTN_PRIMARY}>
          {busy ? "保存中…" : "保存配置"}
        </button>
      </SettingsActions>
    </div>
  );
}
