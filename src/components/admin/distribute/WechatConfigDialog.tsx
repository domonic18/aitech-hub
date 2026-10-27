"use client";

/**
 * 公众号配置弹层(F9 板 configModal):560 单列表单(AppID / AppSecret /
 * 作者署名 / 内容主题)+ 两枚 pill 开关(启用渠道 / 发布自动同步)+
 * 底部「测试连接 · 取消 · 保存」。测试连接实调已保存配置(/cgi-bin/token),
 * 表单有未保存修改时先提示;失败结果行附 IP 白名单指引(40164 人话透出)。
 * AppSecret 只写不读:留空 = 保留旧钥,非空 = 换钥重加密(AES-256-GCM 落库)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { WechatConfigView } from "@/lib/distribute/wechat-config-admin";
import { WECHAT_THEMES } from "@/lib/distribute/wechat-themes";
import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

interface TestOutcome {
  ok: boolean;
  latencyMs: number;
  detail: string;
}

/** pill 开关(F9 板 34×18 胶囊;受控,视觉同 StatusSwitch 不带 endpoint) */
function PillToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-sm border border-line px-3 py-2 text-xs text-text-2 hover:bg-panel-2"
    >
      {label}
      <span
        className={`relative h-[18px] w-[34px] flex-none rounded-full border transition-colors ${
          checked ? "border-accent bg-accent" : "border-line bg-panel-2"
        }`}
      >
        <span
          className={`absolute left-[1px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-[16px]" : ""
          }`}
        />
      </span>
    </button>
  );
}

export default function WechatConfigDialog({
  config,
  onClose,
}: {
  config: WechatConfigView;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appid, setAppid] = useState(config.appid);
  const [appSecret, setAppSecret] = useState("");
  const [author, setAuthor] = useState(config.author ?? "");
  const [theme, setTheme] = useState(config.theme);
  const [paraStyle, setParaStyle] = useState<string>(config.paraStyle);
  const [enableTocMeta, setEnableTocMeta] = useState(config.enableTocMeta);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(config.autoSyncEnabled);
  const [enabled, setEnabled] = useState(config.enabled);

  // 测试结果行:初始回显上次测试态,重测后就地更新
  const [outcome, setOutcome] = useState<TestOutcome | null>(
    config.lastTestStatus === "ok"
      ? { ok: true, latencyMs: config.lastTestLatencyMs ?? 0, detail: `上次测试通过` }
      : config.lastTestStatus === "fail"
        ? { ok: false, latencyMs: 0, detail: config.lastTestError ?? "上次测试失败" }
        : null,
  );
  const [testing, setTesting] = useState(false);
  const [testHint, setTestHint] = useState<string | null>(null);

  const dirty =
    appid !== config.appid ||
    appSecret !== "" ||
    author !== (config.author ?? "") ||
    theme !== config.theme ||
    paraStyle !== config.paraStyle ||
    enableTocMeta !== config.enableTocMeta ||
    autoSyncEnabled !== config.autoSyncEnabled ||
    enabled !== config.enabled;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/distribute/wechat-config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appid: appid.trim(),
          appSecret: appSecret.trim() || null,
          author: author.trim() || null,
          theme,
          paraStyle,
          enableTocMeta,
          autoSyncEnabled,
          enabled,
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (): Promise<void> => {
    if (dirty) {
      setTestHint("表单有未保存的修改,请先保存再测试(「测试连接」探测的是已保存配置)");
      return;
    }
    setTestHint(null);
    setTesting(true);
    try {
      const res = await fetch("/api/distribute/wechat-config/test", { method: "POST" });
      const body = (await res.json()) as ApiEnvelope<TestOutcome | null>;
      if (body.code !== 0 || !body.data) {
        setOutcome({ ok: false, latencyMs: 0, detail: body.message || `HTTP ${res.status}` });
        return;
      }
      setOutcome(body.data);
    } catch (e) {
      setOutcome({ ok: false, latencyMs: 0, detail: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const Lb = "block text-xs text-text-3";

  return (
    <DialogShell width="md" scroll title="公众号配置">
      <div className="mt-3 flex flex-col gap-3">
        <label className={Lb}>
          AppID *
          <input
            autoFocus
            value={appid}
            onChange={(e) => setAppid(e.target.value)}
            maxLength={50}
            placeholder="wx 开头的公众号 AppID"
            className={`mt-1 font-mono ${field}`}
          />
        </label>
        <label className={Lb}>
          AppSecret(写入后加密,不再回显)
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            maxLength={400}
            placeholder={config.appSecretMask ? `留空 = 保留 ${config.appSecretMask}` : "••••••••"}
            autoComplete="new-password"
            className={`mt-1 font-mono ${field}`}
          />
        </label>
        <label className={Lb}>
          作者署名
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            maxLength={64}
            placeholder="缺省「一起AI」"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className={Lb}>
          内容主题(排版配色)
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className={`mt-1 ${field}`}
          >
            {WECHAT_THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className={Lb}>
          段落排版(M51)
          <select
            value={paraStyle}
            onChange={(e) => setParaStyle(e.target.value)}
            className={`mt-1 ${field}`}
          >
            <option value="default">默认(不缩进不对齐)</option>
            <option value="indent">首行缩进两字</option>
            <option value="justify">两端对齐</option>
            <option value="indent_justify">缩进 + 两端对齐</option>
          </select>
        </label>

        <div className="flex flex-col gap-2">
          <PillToggle
            checked={enableTocMeta}
            label="文首阅读时间 + 目录卡(M51)"
            onChange={(v) => setEnableTocMeta(v)}
          />
          <PillToggle checked={enabled} label="启用公众号渠道" onChange={(v) => setEnabled(v)} />
          <PillToggle
            checked={autoSyncEnabled}
            label="文章发布后自动同步"
            onChange={(v) => setAutoSyncEnabled(v)}
          />
        </div>

        <p className="text-[11px] leading-relaxed text-text-3">
          凭据仅存服务端加密存储;「测试连接」探测 access_token 获取接口。
        </p>

        {testHint && <p className="font-mono text-xs text-amber">{testHint}</p>}
        {outcome && (
          <div
            className={`font-mono text-xs ${
              outcome.ok ? "whitespace-pre-wrap text-green" : "whitespace-pre-wrap text-red"
            }`}
          >
            {outcome.ok ? "✓ " : "✗ "}
            {outcome.detail}
            {outcome.ok ? "" : outcome.latencyMs > 0 ? `(${outcome.latencyMs}ms)` : ""}
          </div>
        )}
        {outcome && !outcome.ok && (
          <p className="text-[11px] leading-relaxed text-text-3">
            若报「IP 不在白名单」,把提示中的 IP 加入
            <b className="text-text-2">「公众号后台-设置与开发-基本配置-IP 白名单」</b>
            后重试(本机与生产服务器出口 IP 都需加白)。
          </p>
        )}
        {error && <p className="font-mono text-xs text-red">{error}</p>}
      </div>
      <DialogActions>
        <button
          type="button"
          disabled={testing}
          onClick={() => void runTest()}
          className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2 disabled:opacity-50"
        >
          {testing ? "测试中…" : "测试连接"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy || appid.trim() === ""}
          onClick={() => void submit()}
          className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </DialogActions>
    </DialogShell>
  );
}
