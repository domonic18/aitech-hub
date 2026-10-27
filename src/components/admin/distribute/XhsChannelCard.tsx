"use client";

/**
 * 小红书渠道卡(M49 批X1',F16 渠道行同构;M50 批F 接每日探照):head(名称 +
 * 登录态 chip)+ 分发模式 meta(全自动,批X3)+ 探照行(RSC 直读 kv)+
 * 「配置」钮 → 登录态弹层(Cookie 粘贴,弹窗内实时探针优先于每日快照)。
 */
import { useCallback, useState } from "react";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import type { ApiEnvelope } from "@/lib/http/response";
import type { XhsProbeRecord } from "@/lib/distribute/xhs-probe";
import { formatCnDateTime } from "@/lib/datetime";

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-[13px] text-text-1 outline-none focus:border-accent disabled:opacity-60";

interface XhsStateView {
  storage_state_ready: boolean;
  logged_in: boolean | null;
  error?: string;
}

const ACTION_BTN =
  "cursor-pointer rounded-sm px-1 py-0.5 text-[11px] text-accent hover:bg-accent-dim";

export default function XhsChannelCard({
  lastProbe,
}: {
  /** 每日探照快照(RSC 直读;null=尚未探测过) */
  lastProbe?: XhsProbeRecord | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<XhsStateView | null>(null);
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshState = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/distribute/xiaohongshu/state");
      const json = (await res.json().catch(() => null)) as ApiEnvelope<XhsStateView> | null;
      if (json?.code === 0 && json.data) setState(json.data);
    } catch {
      /* 状态拉取失败保持原样 */
    }
  }, []);

  const openDialog = useCallback((): void => {
    setOpen(true);
    void refreshState();
  }, [refreshState]);

  const save = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/distribute/xiaohongshu/cookies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookieHeader: cookie.trim() }),
      });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      if (!res.ok || json?.code !== 0) {
        setError(json?.message ?? `保存失败(${res.status})`);
        return;
      }
      setCookie("");
      setMsg("登录态已保存,可对已验收贴图执行「一键发布到小红书」");
      await refreshState();
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }, [cookie, refreshState]);

  // 弹窗实时探针优先;未开弹窗时回退每日快照(批F 前 card 面恒「未配置」)
  const loggedIn = state?.logged_in === true || (state === null && lastProbe?.loggedIn === true);
  const knownFailed =
    state?.logged_in === false || (state === null && lastProbe?.loggedIn === false);

  return (
    <div className="flex flex-col rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <svg className="ic text-accent" aria-hidden="true">
            <use href="#i-book" />
          </svg>
          <span className="text-[12.5px] font-medium text-text-1">小红书</span>
        </div>
        <span
          className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
            loggedIn
              ? "bg-green/12 text-green"
              : knownFailed
                ? "bg-red/12 text-red"
                : "bg-panel-2 text-text-3"
          }`}
        >
          {loggedIn ? "已连接" : knownFailed ? "已失效" : "未配置"}
        </span>
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-1.5 text-[11.5px] text-text-2">
        <div>发布方式:全自动(创作平台 Playwright,失败自动重试)</div>
        <div>
          登录态:
          {loggedIn ? "有效" : knownFailed ? "已失效(请重贴 Cookie)" : "未探测"}
        </div>
        <div className="text-text-3">
          每日探测:
          {lastProbe
            ? `${formatCnDateTime(new Date(lastProbe.checkedAt))} · ${
                lastProbe.loggedIn === true
                  ? "有效"
                  : lastProbe.loggedIn === false
                    ? "失效"
                    : `不可达${lastProbe.error ? `(gateway 异常)` : ""}`
              }`
            : "未探测"}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1">
        <button type="button" className={ACTION_BTN} onClick={openDialog}>
          配置
        </button>
      </div>

      {open && (
        <DialogShell width="lg" title="小红书登录态配置">
          <div className="mt-3 flex flex-col gap-3 text-xs">
            <p className="text-text-2">
              在已登录
              <a
                href="https://creator.xiaohongshu.com"
                target="_blank"
                rel="noreferrer"
                className="mx-0.5 text-accent hover:underline"
              >
                小红书创作平台
              </a>
              的浏览器中:F12 → 网络/应用 → 复制完整 Cookie 请求头粘贴到下方。保存后 gateway
              验证登录并持久化,重复保存覆盖旧值、不再回显。
            </p>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              rows={4}
              placeholder="a=b; c=d; …(须含 web_session)"
              className={`${FIELD} font-mono text-[11px]`}
            />
            <div className="rounded-sm border border-line bg-panel-2 px-3 py-2 text-[11px] text-text-3">
              当前状态:
              {state?.logged_in === true
                ? "登录态有效"
                : state?.logged_in === false
                  ? "已失效/未配置"
                  : "未探测"}
              {state?.error ? ` · ${state.error}` : ""}
            </div>
            {msg && <p className="text-[11px] text-green">{msg}</p>}
            {error && <p className="font-mono text-[11px] text-red">{error}</p>}
          </div>
          <DialogActions>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2 disabled:opacity-50"
            >
              关闭
            </button>
            <button
              type="button"
              disabled={busy || cookie.trim().length < 10}
              onClick={() => void save()}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "验证中…(需访问创作平台)" : "保存登录态"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </div>
  );
}
