"use client";

/**
 * 出口代理状态卡(M33 批B,plan M33;形态随 CookiePoolCard):全局单点家宽
 * 出口,抖音/B站采集网关出站一并过境。URL 只写不读(卡面只出
 * scheme://host:port 形 mask,凭据段永不回显);配置弹窗承载换址+启停,
 * 测试按钮经网关 /proxy-test 就地验证落 lastTest 四件套。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import type { ApiEnvelope } from "@/lib/http/response";
import type { EgressProxyConfigView } from "@/lib/telegram/egress-proxy";

function fmtTime(iso: string | null): string {
  return iso ? iso.replace("T", " ").slice(0, 16) : "—";
}

export default function EgressProxyCard({ config }: { config: EgressProxyConfigView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(config.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const configured = Boolean(config.proxyUrlMask);

  const openDialog = (): void => {
    setUrl("");
    setEnabled(config.enabled);
    setError(null);
    setOpen(true);
  };

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/proxy/config/", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // 留空 = 保留原址(仅改启停);首次配置必须填 URL(服务端兜底校验)
        body: JSON.stringify({
          ...(url.trim() ? { proxyUrl: url.trim() } : {}),
          enabled,
        }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      setMsg({ ok: true, text: "已保存,即时生效(下一次网关请求即走新出口)" });
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function test(): Promise<void> {
    setTestBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/proxy/test/", { method: "POST" });
      const body = (await res.json()) as ApiEnvelope<{ latencyMs?: number }>;
      setMsg({ ok: body.code === 0, text: body.message || `HTTP ${res.status}` });
      router.refresh(); // lastTest 四件套落库后同步卡面
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setTestBusy(false);
    }
  }

  const statusLine = config.enabled ? (
    <span className="font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-green">
      已启用
    </span>
  ) : configured ? (
    <span className="font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-amber">
      已停用
    </span>
  ) : (
    <span className="font-mono text-[26px] font-bold leading-none tracking-[-0.01em] text-text-3">
      未配置
    </span>
  );

  return (
    <div className="rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
        <svg className="ic text-accent" aria-hidden="true">
          <use href="#i-global" />
        </svg>
        出口代理(抖音/B站 · 全局)
      </div>
      <div className="mt-2">{statusLine}</div>
      <div className="mt-1.5 space-y-0.5 font-mono text-[11px] text-text-3">
        <div className="truncate" title={config.proxyUrlMask ?? undefined}>
          {config.proxyUrlMask ?? "直连(未配置代理)"}
        </div>
        {config.lastTestStatus ? (
          <div>
            探测 {fmtTime(config.lastTestedAt)} ·{" "}
            {config.lastTestStatus === "ok" ? (
              <span className="text-green">正常({config.lastTestLatencyMs ?? "?"}ms)</span>
            ) : (
              <span className="text-red" title={config.lastTestError ?? undefined}>
                失败
              </span>
            )}
          </div>
        ) : (
          <div>(未探测;代理断连=基建错误,不冷却 Cookie jar)</div>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={openDialog}
          className="cursor-pointer rounded-sm border border-line px-2 py-1 text-[11px] text-text-2 hover:bg-panel-2"
        >
          {configured ? "配置" : "接入代理"}
        </button>
        <button
          type="button"
          disabled={!configured || !config.enabled || testBusy}
          title={
            !configured
              ? "先配置代理 URL"
              : !config.enabled
                ? "代理已停用"
                : "经网关探测 B 站连通性"
          }
          onClick={() => void test()}
          className="cursor-pointer rounded-sm border border-line px-2 py-1 text-[11px] text-text-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testBusy ? "探测中…" : "测试"}
        </button>
      </div>
      {msg && (
        <div className={`mt-1.5 text-[11px] ${msg.ok ? "text-green" : "text-red"}`}>{msg.text}</div>
      )}

      {open && (
        <DialogShell width="lg" title={configured ? "配置出口代理" : "接入出口代理"}>
          <p className="mt-1 text-[11px] leading-relaxed text-text-3">
            填家宽代理地址(支持 http(s) 与 socks4/5,socks5h = 域名解析也在代理侧);
            启用后采集网关全部出站(B站/抖音)都经此出口。URL 加密落库只写不读,卡面仅显示
            scheme://host:port 形脱敏;AUTH_SECRET 轮换会使密文失效,需重填。
          </p>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={500}
            placeholder={config.proxyUrlMask ?? "socks5h://user:pass@家庭宽带host:port"}
            className="mt-3 w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 font-mono text-xs text-text-1 outline-none focus:border-accent placeholder:text-text-3"
            autoComplete="off"
          />
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-text-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            启用(关闭=全部直连,配置保留可随时再开)
          </label>
          {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || (!configured && url.trim().length < 8)}
              onClick={() => void save()}
              className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </div>
  );
}
