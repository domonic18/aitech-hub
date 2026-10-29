"use client";

/**
 * 渠道管理(M56 批B):牌价渠道 URL/启停后台可调零发版——解析器住代码
 * (key/kind 只读展示),url/enabled 落 pricing_source 表即改即生效(下次
 * 爬取按新值执行)。PUT /api/pricing/sources/[key],router.refresh 重取。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ApiEnvelope } from "@/lib/http/response";

export interface PricingSourceView {
  key: string;
  target: string;
  kind: string;
  label: string;
  vendor: string;
  url: string;
  enabled: boolean;
}

type Msg = { tone: "ok" | "err"; text: string } | null;

const TARGET_LABELS: Record<string, string> = { model: "模型行", plan: "套餐" };
const KIND_LABELS: Record<string, string> = {
  static: "静态直取",
  rendered: "渲染快照",
  api: "接口",
};

export default function SourcesBoard({ rows }: { rows: PricingSourceView[] }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r.url])),
  );

  async function save(key: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const url = (drafts[key] ?? "").trim();
    const res = await fetch(`/api/pricing/sources/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const env = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
    setMsg({ tone: (env?.code ?? 1) === 0 ? "ok" : "err", text: env?.message ?? "保存失败" });
    if (env?.code === 0) router.refresh();
    setBusy(false);
  }

  async function toggle(key: string, enabled: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/pricing/sources/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const env = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
    setMsg({ tone: (env?.code ?? 1) === 0 ? "ok" : "err", text: env?.message ?? "操作失败" });
    if (env?.code === 0) router.refresh();
    setBusy(false);
  }

  const input =
    "w-full rounded-sm border border-line bg-panel-2 px-2 py-1 font-mono text-xs outline-none focus:border-accent";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">渠道管理</h3>
        <span className="text-[11px] text-text-3">
          URL/启停即改即生效(下次爬取按新值) · 解析器随版本发布,改解析逻辑才发版
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-[11px] text-text-3">
              <th className="px-4 py-2 font-medium">渠道</th>
              <th className="px-2 py-2 font-medium">官方页 URL</th>
              <th className="px-2 py-2 font-medium">状态</th>
              <th className="px-2 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-2.5">
                  <div className="text-xs font-semibold text-text-1">{r.label}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-3">
                    <span className="font-mono">{r.key}</span>
                    <span>· {TARGET_LABELS[r.target] ?? r.target}</span>
                    <span>· {KIND_LABELS[r.kind] ?? r.kind}</span>
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <input
                    value={drafts[r.key] ?? r.url}
                    onChange={(e) => setDrafts({ ...drafts, [r.key]: e.target.value })}
                    className={input}
                    aria-label={`${r.label} URL`}
                  />
                </td>
                <td className="px-2 py-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggle(r.key, !r.enabled)}
                    className={`rounded-sm px-2 py-0.5 text-[11px] disabled:opacity-50 ${
                      r.enabled
                        ? "bg-green/12 text-green"
                        : "bg-panel-2 text-text-3 hover:text-text-1"
                    }`}
                  >
                    {r.enabled ? "启用中" : "已停用"}
                  </button>
                </td>
                <td className="px-2 py-2.5">
                  <button
                    type="button"
                    disabled={busy || (drafts[r.key] ?? r.url) === r.url}
                    onClick={() => void save(r.key)}
                    className="text-xs text-accent hover:underline disabled:opacity-40"
                  >
                    保存 URL
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg !== null && (
        <span className={`text-xs ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
