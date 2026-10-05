"use client";

/**
 * 媒体库选图弹层(M14 批⑤,封面双源之二):GET /api/media/pick 近图分页 +
 * 文件名搜索,点选回调 path。缩略缺位(刚上传 sharp 未就绪)回退原图。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";

export interface PickItem {
  path: string;
  thumbPath: string | null;
  width: number | null;
  height: number | null;
  filename: string;
}

interface PickData {
  items: PickItem[];
  page: number;
  total: number;
  pageSize: number;
}

export default function MediaPicker({
  onPick,
  onClose,
}: {
  onPick: (item: PickItem) => void;
  onClose: () => void;
}): React.ReactElement {
  const [data, setData] = useState<PickData | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (page: number, query: string): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`/api/media/pick?page=${page}&q=${encodeURIComponent(query)}`);
      const body = (await res.json()) as ApiEnvelope<PickData>;
      if (body.code !== 0 || !body.data) {
        setError(body.message || `加载失败(${res.status})`);
        return;
      }
      setData(body.data);
    } catch {
      setError("网络错误,请重试");
    }
  }, []);

  useEffect(() => {
    void load(1, "");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [load]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[720px] flex-col overflow-hidden rounded-md border border-line bg-panel p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">从媒体库选图</h3>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={q}
              placeholder="按文件名搜索…"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load(1, q.trim());
              }}
              className="w-40 rounded-sm border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-text-1 outline-none placeholder:text-text-3 focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void load(1, q.trim())}
              className="cursor-pointer rounded-sm border border-line px-2.5 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              搜索
            </button>
            <button
              type="button"
              aria-label="关闭"
              className="cursor-pointer text-text-3 hover:text-text-1"
              onClick={onClose}
            >
              <svg className="ic" aria-hidden="true">
                <use href="#i-close" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-3 grid flex-1 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {data?.items.map((it) => (
            <button
              key={it.path}
              type="button"
              title={`${it.filename}${it.width !== null ? ` · ${it.width}×${it.height}` : ""}`}
              onClick={() => onPick(it)}
              className="group cursor-pointer overflow-hidden rounded-sm border border-line hover:border-accent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部选图,src 为站内路径 */}
              <img
                src={it.thumbPath ?? it.path}
                alt={it.filename}
                loading="lazy"
                className="h-20 w-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
          ))}
          {data && data.items.length === 0 && (
            <div className="col-span-full py-10 text-center text-xs text-text-3">
              没有匹配的图片{q ? `(搜索「${q}」)` : ",先在媒体库上传"}
            </div>
          )}
        </div>

        {error && <div className="mt-2 text-xs text-red">{error}</div>}
        {data && (
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-3">
            <span className="font-mono">
              共 {data.total} 张 · 第 {data.page} /{" "}
              {Math.max(1, Math.ceil(data.total / data.pageSize))} 页
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => void load(data.page - 1, q.trim())}
                className="cursor-pointer rounded-sm border border-line px-2 py-1 text-text-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={data.page >= Math.ceil(data.total / data.pageSize)}
                onClick={() => void load(data.page + 1, q.trim())}
                className="cursor-pointer rounded-sm border border-line px-2 py-1 text-text-2 hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
