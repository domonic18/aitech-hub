"use client";

/**
 * 公众号配置编辑弹窗(M17 批①,镜像 AsrDialog):表单态与提交仅弹窗内消费,
 * 卡片描述网格直接读 config prop;每次挂载即打开,关闭即卸载(编辑态不残留)。
 * AppSecret 只写不读:留空 = 保留旧钥,非空 = 换钥重加密(AES-256-GCM 落库)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { WechatConfigView } from "@/lib/distribute/wechat-config-admin";
import { WECHAT_THEMES } from "@/lib/distribute/wechat-themes";
import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

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
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(config.autoSyncEnabled);
  const [enabled, setEnabled] = useState(config.enabled);

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

  return (
    <DialogShell width="xl" scroll title="编辑公众号配置">
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-text-3">
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
        <label className="text-xs text-text-3">
          图文作者
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            maxLength={64}
            placeholder="缺省「一起AI」"
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="text-xs text-text-3">
          默认正文主题
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
          <span className="mt-1 block text-[11px] text-text-3">
            标题/引用/链接等强调色;单篇可覆盖
          </span>
        </label>
        <label className="col-span-2 text-xs text-text-3">
          AppSecret{" "}
          <span className="text-amber">(留空 = 保留 {config.appSecretMask ?? "现有密钥"})</span>
          <input
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            maxLength={400}
            placeholder="••••••••"
            autoComplete="new-password"
            className={`mt-1 font-mono ${field}`}
          />
          <span className="mt-1 block text-[11px] text-amber">
            保存后 AES-256-GCM 加密落库,界面仅回显掩码;AUTH_SECRET 轮换会使密文失效,需重录。
          </span>
        </label>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs text-text-2">
          <input
            type="checkbox"
            checked={autoSyncEnabled}
            onChange={(e) => setAutoSyncEnabled(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          发布文章时自动推公众号草稿(默认关)
        </label>
        <label className="flex items-center gap-2 text-xs text-text-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          启用公众号渠道(建议测试连接通过后再开启)
        </label>
      </div>
      {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
      <DialogActions>
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
