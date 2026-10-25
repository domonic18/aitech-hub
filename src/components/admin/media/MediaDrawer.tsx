"use client";

/**
 * 媒体详情抽屉(原型 admin-media §4):点卡片开,GET /api/media/[id] 拉取
 * (preview / kv / 引用方文章 / 复制URL / 删除);删除走 DELETE(409 = 仍被引用,
 * 按钮置灰),成功回调 onDeleted(父级关抽屉 + router.refresh)。预览图点击
 * 唤起 MediaViewer 全屏查看(2026-10-20 反馈问题三);Esc 只关最上层——查看器
 * 开着时本抽屉让行(状态门控,不赌监听顺序)。
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { type MediaDetailData, formatBytes, MEDIA_LIMITS } from "@/lib/media/media-schema";

import MediaViewer from "./MediaViewer";

type Detail = MediaDetailData;

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
  /** 查看器载荷(原图路径;null = 关闭) */
  const [viewer, setViewer] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    setViewer(null);
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
    // 查看器开着:Esc 归最上层(MediaViewer 自理),本抽屉让行不订阅
    if (viewer) return;
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose, viewer]);

  const remove = useCallback(async () => {
    if (!detail) return;
    if (!window.confirm(`确认删除该媒体?进入回收站,${MEDIA_LIMITS.trashDays} 天后物理清除。`))
      return;
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
        className="h-full w-full overflow-y-auto border-l border-line bg-panel p-5 sm:w-[420px]"
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
            <button
              type="button"
              title="点击放大查看"
              className="mt-4 flex h-44 w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-sm border border-line bg-panel-2"
              onClick={() => setViewer({ src: m.path, alt: m.filename })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部预览,src 为站内动态路径 */}
              <img
                src={preview ?? undefined}
                alt={m.filename}
                className="max-h-full max-w-full object-contain"
              />
            </button>

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
      {viewer && <MediaViewer src={viewer.src} alt={viewer.alt} onClose={() => setViewer(null)} />}
    </div>
  );
}
