"use client";

/**
 * 渠道表单弹窗(M7 批④,PatCreateDialog 同款交互):创建/编辑共用。
 * 凭证只写不读:placeholder 展示脱敏掩码,留空=沿用;「清除」勾选后提交空串;
 * 新填值覆盖。频率字段即 crawl_interval_min / daily_max_requests。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { CRAWL_SOURCE_TYPES } from "@/lib/telegram/constants";
import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

export interface ChannelDialogData {
  id: number;
  name: string;
  type: string;
  platform: string | null;
  url: string;
  crawlIntervalMin: number;
  dailyMaxRequests: number | null;
  remark: string | null;
  enabled: boolean;
  credentialMask: string;
}

const TYPE_LABELS: Record<string, string> = {
  rss: "RSS/Atom",
  web: "网页",
  api: "API",
  "social-video": "社交/视频",
};

export default function ChannelDialog({
  label,
  channel,
  buttonClass,
}: {
  label: string;
  channel?: ChannelDialogData;
  buttonClass?: string;
}) {
  const router = useRouter();
  const editing = channel !== undefined;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(channel?.name ?? "");
  const [type, setType] = useState(channel?.type ?? "rss");
  const [platform, setPlatform] = useState(channel?.platform ?? "");
  const [url, setUrl] = useState(channel?.url ?? "");
  const [interval, setIntervalMin] = useState(String(channel?.crawlIntervalMin ?? 30));
  const [dailyMax, setDailyMax] = useState(channel?.dailyMaxRequests?.toString() ?? "");
  const [remark, setRemark] = useState(channel?.remark ?? "");
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setOpen(false);
    setError(null);
    setToken("");
    setClearToken(false);
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name,
      type,
      platform: platform.trim() || null,
      url: url.trim(),
      crawlIntervalMin: Number(interval),
      dailyMaxRequests: dailyMax.trim() === "" ? null : Number(dailyMax),
      remark: remark.trim() || null,
      enabled,
    };
    if (clearToken) payload.token = "";
    else if (token.trim() !== "") payload.token = token.trim();
    try {
      const res = await fetch(editing ? `/api/channels/${channel.id}` : "/api/channels", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      close();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => nameRef.current?.focus(), 0);
        }}
        className={
          buttonClass ??
          "rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        }
      >
        {label}
      </button>
      {open && (
        <DialogShell width="lg" scroll title={editing ? "编辑渠道" : "新增渠道"}>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="col-span-1 text-xs text-text-3">
              名称 *
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="col-span-1 text-xs text-text-3">
              类型
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={`mt-1 ${field}`}
              >
                {CRAWL_SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 text-xs text-text-3">
              端点(feed/API 地址;勿携带凭证参数) *
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/feed"
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="col-span-1 text-xs text-text-3">
              平台标识(可选)
              <input
                value={platform ?? ""}
                onChange={(e) => setPlatform(e.target.value)}
                maxLength={20}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="col-span-1 text-xs text-text-3">
              凭证(token/apiKey;留空{editing ? "沿用" : "不设"})
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={channel?.credentialMask || "无凭证"}
                disabled={clearToken}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="col-span-1 text-xs text-text-3">
              采集间隔(分钟,5-1440)
              <input
                type="number"
                min={5}
                max={1440}
                value={interval}
                onChange={(e) => setIntervalMin(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="col-span-1 text-xs text-text-3">
              每日请求上限(留空=不限)
              <input
                type="number"
                min={1}
                value={dailyMax}
                onChange={(e) => setDailyMax(e.target.value)}
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="col-span-2 text-xs text-text-3">
              备注
              <input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                maxLength={200}
                className={`mt-1 ${field}`}
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs">
            {/* 启用开关新建/编辑都渲染(2026-10-06 验收反馈问题3,原型「保存后立即启用并首采」) */}
            <label className="flex items-center gap-1.5 text-text-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              {editing ? "启用调度" : "保存后立即启用并首采"}
            </label>
            {editing && channel.credentialMask !== "" && (
              <label className="flex items-center gap-1.5 text-text-2">
                <input
                  type="checkbox"
                  checked={clearToken}
                  onChange={(e) => setClearToken(e.target.checked)}
                />
                清除凭证(现 {channel.credentialMask})
              </label>
            )}
          </div>
          {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={close}
              className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || name.trim() === "" || url.trim() === ""}
              onClick={() => void submit()}
              className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </>
  );
}
