"use client";

/**
 * 小红书渠道卡(M49 批X1':替代「即将接入」占位转正):登录态管理
 * (Cookie 池卡同款 UX——textarea 粘贴完整 Cookie 请求头,加密语义由
 * gateway 侧卷持久化承载,粘贴一次全局生效)+ 分发状态行。
 * 半自动模式:发布动作人工(无官方发布 API,plan M49 调研)。
 */
import { useEffect, useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";

interface XhsStateView {
  storage_state_ready: boolean;
  logged_in: boolean | null;
  error?: string;
}

const FIELD =
  "w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-[13px] text-text-1 outline-none focus:border-accent disabled:opacity-60";

export default function XhsChannelCard(): React.ReactElement {
  const [state, setState] = useState<XhsStateView | null>(null);
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      const res = await fetch("/api/distribute/xiaohongshu/state");
      const json = (await res.json().catch(() => null)) as ApiEnvelope<XhsStateView> | null;
      if (json?.code === 0 && json.data) setState(json.data);
    } catch {
      /* 状态卡静默(gateway 未启动等) */
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const save = async (): Promise<void> => {
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
      setMsg("登录态已保存,可直接对已验收贴图执行「一键发布到小红书」");
      await refresh();
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  };

  const loggedIn = state?.logged_in === true;

  return (
    <div className="rounded-md border border-line bg-panel px-4 py-4">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-text-1">小红书</span>
        <span
          className={`rounded-sm px-1.5 py-0.5 text-[10px] ${
            loggedIn ? "bg-green/12 text-green" : "bg-panel-2 text-text-3"
          }`}
        >
          {loggedIn ? "登录态有效" : "登录态未配置"}
        </span>
      </div>
      <div className="mt-2 text-[11.5px] text-text-2">
        图文笔记发布(半自动:贴图即物料,发布动作在创作平台人工完成,发布后回填笔记链接)
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-[11px] text-text-3" htmlFor="xhs-cookie">
          从已登录小红书创作平台的浏览器完整复制 Cookie 请求头;重复保存覆盖旧值,保存后不再回显。
        </label>
        <textarea
          id="xhs-cookie"
          value={cookie}
          onChange={(e) => setCookie(e.target.value)}
          rows={3}
          placeholder="a=b; c=d; …(须含 web_session)"
          className={`${FIELD} font-mono text-[11px]`}
        />
        <button
          type="button"
          disabled={busy || cookie.trim().length < 10}
          onClick={() => void save()}
          className="mt-1.5 w-full cursor-pointer rounded-sm border border-accent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "验证并保存中…(需访问创作平台)" : "保存登录态"}
        </button>
        {msg && <p className="mt-1 text-[11px] text-green">{msg}</p>}
        {error && <p className="mt-1 text-[11px] text-red">{error}</p>}
      </div>
    </div>
  );
}
