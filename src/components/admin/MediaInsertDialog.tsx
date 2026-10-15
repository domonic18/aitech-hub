"use client";

/**
 * 编辑器「从媒体库插入」选图弹窗(2026-10-15 验收反馈问题三):窄口清单
 * (GET /api/media?scope=picker)缩略图网格,点选即回调 onInsert(由编辑器在
 * 光标处插 `![文件名](路径)` 并关弹窗)。文件名搜索 + 「加载更多」增量分页。
 */
import { useCallback, useEffect, useState } from "react";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import { field } from "@/components/admin/form-fields";
import { type ApiEnvelope } from "@/lib/http/response";

interface PickerItem {
  id: string;
  path: string;
  filename: string;
  thumbPath: string | null;
}

type PickerBody = ApiEnvelope<{ items: PickerItem[]; total: number; page: number } | null>;

const ACCENT_BTN =
  "rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50";
const GHOST_BTN = "rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2";

export default function MediaInsertDialog({
  onInsert,
  onClose,
}: {
  onInsert: (path: string, filename: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<PickerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (query: string, nextPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ scope: "picker", page: String(nextPage) });
      if (query) sp.set("q", query);
      const res = await fetch(`/api/media?${sp.toString()}`);
      const body = (await res.json().catch(() => null)) as PickerBody | null;
      if (res.ok && body?.code === 0 && body.data) {
        const data = body.data;
        setItems((prev) => (nextPage === 1 ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
        setPage(nextPage);
      } else {
        setError(body?.message ?? `加载失败(${res.status})`);
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("", 1);
  }, [load]);

  function search(): void {
    const next = qDraft.trim();
    setQ(next);
    void load(next, 1);
  }

  return (
    <DialogShell width="2xl" scroll title="从媒体库插入图片">
      <div className="mt-3 flex gap-2">
        <input
          value={qDraft}
          onChange={(e) => setQDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
          placeholder="按文件名搜索…"
          maxLength={100}
          className={`${field} h-auto py-1.5 text-xs`}
        />
        <button type="button" onClick={search} className={GHOST_BTN}>
          搜索
        </button>
      </div>
      {error && <div className="mt-3 text-xs text-red">{error}</div>}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.filename}
            className="group block h-24 overflow-hidden rounded-sm border border-line bg-panel-2 hover:border-accent"
            onClick={() => {
              onInsert(item.path, item.filename);
              onClose();
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内动态路径 */}
            <img
              src={item.thumbPath ?? item.path}
              alt={item.filename}
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          </button>
        ))}
      </div>
      {items.length === 0 && !loading && !error && (
        <div className="mt-3 text-center text-xs text-text-3">
          媒体库暂无可用图片(先上传或生成封面)
        </div>
      )}
      <DialogActions>
        {items.length < total && (
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(q, page + 1)}
            className={ACCENT_BTN}
          >
            {loading ? "加载中…" : `加载更多(已 ${items.length}/${total})`}
          </button>
        )}
        <button type="button" onClick={onClose} className={GHOST_BTN}>
          关闭
        </button>
      </DialogActions>
    </DialogShell>
  );
}
