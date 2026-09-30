"use client";

/**
 * 媒体详情抽屉(原型 admin-media §4):点卡片开,GET /api/media/[id] 拉取
 * (preview / kv / 引用方文章 / 复制URL / 删除);删除走 DELETE(409 = 仍被引用,
 * 按钮置灰),成功回调 onDeleted(父级关抽屉 + router.refresh)。
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatBytes } from "@/lib/media/media-schema";

interface DetailRefs {
  id: string;
  slug: string;
  title: string;
  publishedAt: string | null;
}

export interface DetailMedia {
  id: string;
  path: string;
  filename: string;
  kind: string;
  status: string;
  storage: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  sha1: string | null;
  thumbPath: string | null;
  createdAt: string;
}

interface Detail {
  media: DetailMedia;
  refs: DetailRefs[];
}

export default function MediaDrawer({
  id,
  onClose,
  onDeleted,
}: {
  id: string;
  onClose: () => void;
  onDeleted: () => void;
}): React.ReactElement {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    fetch(`/api/media/${id}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { data?: Detail } | null;
        if (!alive) return;
        if (res.ok && body?.data) setDetail(body.data);
        else setError(`加载失败(${res.status})`);
      })
      .catch(() => {
        if (alive) setError("网络错误,请重试");
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const remove = useCallback(async () => {
    if (!detail) return;
    if (!window.confirm("确认删除该媒体?进入回收站,7 天后物理清除。")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/media/${id}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted();
        return;
      }
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? `删除失败(${res.status})`);
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  }, [detail, id, onDeleted]);

  const m = detail?.media;
  const preview = m ? (m.thumbPath ?? m.path) : null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="h-full w-[420px] overflow-y-auto border-l border-line bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">媒体详情</h3>
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

        {error && <p className="mt-4 text-xs text-red">{error}</p>}
        {!detail && !error && <p className="mt-4 text-xs text-text-3">加载中…</p>}

        {m && (
          <>
            <div className="mt-4 flex h-44 items-center justify-center overflow-hidden rounded-sm border border-line bg-panel-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部预览,src 为站内动态路径 */}
              <img
                src={preview ?? undefined}
                alt={m.filename}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            <dl className="mt-4 space-y-1.5 text-xs">
              {[
                ["文件名", m.filename],
                ["路径", m.path],
                ["尺寸", m.width !== null ? `${m.width} × ${m.height}` : "—"],
                ["大小", m.sizeBytes !== null ? formatBytes(m.sizeBytes) : "—"],
                ["sha1", m.sha1 ?? "—"],
                ["存储", m.storage === "local" ? "本地卷" : m.storage],
                ["上传时间", m.createdAt.slice(0, 19).replace("T", " ")],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-16 shrink-0 text-text-3">{k}</dt>
                  <dd className="min-w-0 break-all font-mono text-text-1">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4">
              <div className="text-xs text-text-3">引用方({detail.refs.length})</div>
              {detail.refs.length === 0 ? (
                <p className="mt-2 text-xs text-text-3">暂无文章引用</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {detail.refs.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/admin/posts/${p.id}`}
                        className="block truncate text-xs text-accent hover:underline"
                      >
                        {p.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
              <button
                type="button"
                className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:border-line-hover hover:text-text-1"
                onClick={() => {
                  void navigator.clipboard.writeText(m.path);
                }}
              >
                复制 URL
              </button>
              <button
                type="button"
                disabled={busy || detail.refs.length > 0}
                title={detail.refs.length > 0 ? "仍有文章引用,先移除引用" : undefined}
                className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-red hover:border-red disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void remove()}
              >
                {busy ? "删除中…" : "删除"}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
