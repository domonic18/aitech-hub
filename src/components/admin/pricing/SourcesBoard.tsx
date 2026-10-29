"use client";

/**
 * 渠道管理(M56 批B 建;2026-10-29 验收反馈二重构,对齐系统交互范式):
 * URL 列只读展示(截断+外链),编辑走 DialogShell 弹窗(与 ChannelDialog
 * 等七处同壳防漂移);启停用 StatusSwitch 胶囊开关(同渠道/博主台账);
 * 行操作按钮对齐 RowOps 样式(px-2 py-1 hover:bg)。解析器住代码,key/kind
 * 只读;url/enabled 后台可调零发版。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import StatusSwitch from "@/components/admin/StatusSwitch";
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

const TARGET_LABELS: Record<string, string> = { model: "模型行", plan: "套餐" };
const KIND_LABELS: Record<string, string> = {
  static: "静态直取",
  rendered: "渲染快照",
  api: "接口",
};

export default function SourcesBoard({ rows }: { rows: PricingSourceView[] }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<PricingSourceView | null>(null);
  const [draftUrl, setDraftUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function saveUrl(): Promise<void> {
    if (editing === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pricing/sources/${editing.key}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: draftUrl.trim() }),
      });
      const env = (await res.json().catch(() => null)) as ApiEnvelope | null;
      if ((env?.code ?? 1) !== 0) {
        setError(env?.message ?? "保存失败");
        return;
      }
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

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
              <th className="px-2 py-2 font-medium">启用</th>
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
                <td className="max-w-[380px] px-2 py-2.5">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${r.url}(点击打开)`}
                    className="block truncate font-mono text-xs text-text-2 hover:text-blue"
                  >
                    {r.url}
                  </a>
                </td>
                <td className="px-2 py-2.5">
                  <StatusSwitch
                    endpoint={`/api/pricing/sources/${r.key}`}
                    enabled={r.enabled}
                    name={r.label}
                    disableHint={`确认停用渠道「${r.label}」?停用后下次爬取不再执行该渠道。`}
                  />
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center justify-end gap-1.5 whitespace-nowrap text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(r);
                        setDraftUrl(r.url);
                        setError(null);
                      }}
                      className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
                      disabled={busy}
                    >
                      编辑 URL
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <DialogShell width="lg" title={`编辑渠道 URL:${editing.label}`}>
          <p className="mb-3 font-mono text-[11px] text-text-3">{editing.key}</p>
          <label className="mb-1 block text-[11px] text-text-3" htmlFor="source-url-input">
            官方页 URL(rendered 型渠道为快照目标;即改即生效)
          </label>
          <input
            id="source-url-input"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            className="w-full rounded-sm border border-line bg-panel-2 px-2 py-1.5 font-mono text-xs outline-none focus:border-accent"
            placeholder="https://…"
          />
          {error !== null && <p className="mt-2 text-xs text-red">{error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="cursor-pointer rounded-sm px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || draftUrl.trim() === ""}
              onClick={() => void saveUrl()}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--accent-contrast)] hover:opacity-90 disabled:opacity-50"
            >
              保存
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </div>
  );
}
