"use client";

/**
 * 媒体库网格(原型 admin-media §3):卡片 + 引用徽标 + 未引用过滤下的勾选批量删除;
 * 点卡片开详情抽屉(MediaDrawer)。批量删除走 POST /api/media/batch-delete
 * (逐条引用检查,被引用的自动跳过并列出),成功后 router.refresh 重拉本页 RSC。
 * 回收站过滤(2026-10-08):卡片不进抽屉(详情 404)、不可勾选,改挂「剩 N 天」徽标与
 * 恢复/立即清除行内动作(POST /api/media/[id]/restore · DELETE /api/media/[id]/purge)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { type ApiEnvelope } from "@/lib/http/response";
import {
  formatBytes,
  type MediaRefFilter,
  type MediaStatus,
  type BatchDeleteResult,
  MEDIA_LIMITS,
} from "@/lib/media/media-schema";
import type { MediaListItem } from "@/lib/media/queries";

import MediaDrawer from "./MediaDrawer";

/** active 为常态不挂徽标;deleted 行不进列表(Partial = 其余状态显式挂徽标,评审 W3)
 *  徽标挂缩略图左上角(原型 admin-media 覆层式,黑透明底保证图上可读) */
const STATUS_LABELS: Partial<Record<MediaStatus, { text: string; cls: string }>> = {
  processing: { text: "处理中", cls: "bg-black/60 text-text-2" },
  error: { text: "处理失败", cls: "bg-black/60 text-red" },
  missing: { text: "文件丢失", cls: "bg-black/60 text-red" },
  orphan: { text: "未引用", cls: "bg-black/60 text-amber" },
};

function RefBadge({ item }: { item: MediaListItem }): React.ReactElement {
  if (item.refCount > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] text-green">
        <svg className="ic ic-sm" aria-hidden="true">
          <use href="#i-check" />
        </svg>
        引用 {item.refCount}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] text-amber">
      <svg className="ic ic-sm" aria-hidden="true">
        <use href="#i-warning" />
      </svg>
      孤儿
    </span>
  );
}

export default function MediaGrid({
  items,
  refFilter,
}: {
  items: MediaListItem[];
  refFilter: MediaRefFilter;
}): React.ReactElement {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [trashMsg, setTrashMsg] = useState<string | null>(null);

  const selectable = refFilter === "orphan";
  const trashMode = refFilter === "trash";
  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 回收站行内动作:恢复(清软删标记)/ 立即清除(物理删,确认后执行) */
  async function trashAction(id: string, action: "restore" | "purge"): Promise<void> {
    if (action === "purge" && !window.confirm("立即清除将物理删除文件且不可恢复,确定?")) return;
    setBusyId(id);
    setTrashMsg(null);
    try {
      const res = await fetch(`/api/media/${id}/${action}`, {
        method: action === "restore" ? "POST" : "DELETE",
      });
      const body = (await res.json().catch(() => null)) as ApiEnvelope<{
        id: string;
        path: string;
        status?: string;
      } | null> | null;
      if (res.ok && body?.code === 0) {
        setTrashMsg(action === "restore" ? "已恢复" : "已清除");
        router.refresh();
      } else {
        setTrashMsg(body?.message ?? `操作失败(${res.status})`);
      }
    } catch {
      setTrashMsg("网络错误,请重试");
    } finally {
      setBusyId(null);
    }
  }

  async function batchDelete(): Promise<void> {
    setBatchBusy(true);
    setBatchMsg(null);
    try {
      const res = await fetch("/api/media/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const body = (await res
        .json()
        .catch(() => null)) as ApiEnvelope<BatchDeleteResult | null> | null;
      if (res.ok && body?.code === 0 && body.data) {
        const skipped = body.data.skipped
          .map((s) => `《${s.filename}》被引用 ${s.refCount} 篇`)
          .join("、");
        setBatchMsg(
          `已删除 ${body.data.deleted} 项${skipped ? `;跳过:${skipped}` : ""}。回收站保留 ${MEDIA_LIMITS.trashDays} 天。`,
        );
        setSelected(new Set());
        router.refresh();
      } else {
        setBatchMsg(body?.message ?? `批量删除失败(${res.status})`);
      }
    } catch {
      setBatchMsg("网络错误,请重试");
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <>
      {selectable && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-sm border border-line bg-panel px-4 py-2.5 text-xs">
          <span className="text-text-2">已选 {selected.size} 项</span>
          <button
            type="button"
            disabled={batchBusy}
            className="cursor-pointer text-red hover:underline disabled:opacity-50"
            onClick={() => void batchDelete()}
          >
            {batchBusy ? "删除中…" : "批量删除未引用项"}
          </button>
          <button
            type="button"
            className="cursor-pointer text-text-3 hover:text-text-1"
            onClick={() => setSelected(new Set())}
          >
            取消选择
          </button>
          {batchMsg && <span className="text-text-2">{batchMsg}</span>}
        </div>
      )}

      {trashMode && trashMsg && (
        <div className="rounded-sm border border-line bg-panel px-4 py-2 text-xs text-text-2">
          {trashMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {items.map((item) => {
          const statusBadge = STATUS_LABELS[item.status];
          const preview = item.thumbPath ?? item.path;
          return (
            <div
              key={item.id}
              className={`overflow-hidden rounded-sm border bg-panel transition-colors ${
                selected.has(item.id) ? "border-accent" : "border-line hover:border-line-hover"
              }`}
            >
              <div className="relative">
                <button
                  type="button"
                  disabled={trashMode}
                  className={`block h-28 w-full overflow-hidden bg-panel-2 ${
                    trashMode ? "cursor-default" : "cursor-pointer"
                  }`}
                  onClick={() => setOpenId(item.id)}
                  title={item.filename}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内动态路径 */}
                  <img
                    src={preview}
                    alt={item.filename}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </button>
                <div className="pointer-events-none absolute left-1.5 top-1.5 flex gap-1">
                  {trashMode ? (
                    <span
                      className={`rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] ${
                        (item.daysLeft ?? 0) <= 1 ? "text-red" : "text-text-2"
                      }`}
                    >
                      剩 {item.daysLeft ?? 0} 天
                    </span>
                  ) : (
                    <>
                      <RefBadge item={item} />
                      {statusBadge && (
                        <span className={`rounded-sm px-1.5 py-0.5 text-[10px] ${statusBadge.cls}`}>
                          {statusBadge.text}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-1 px-2 py-1.5">
                <div className="flex items-center gap-1">
                  {selectable ? (
                    <label className="flex min-w-0 cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-[var(--accent)]"
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                      <span className="truncate text-[11px] text-text-2" title={item.filename}>
                        {item.filename}
                      </span>
                    </label>
                  ) : (
                    <span className="truncate text-[11px] text-text-2" title={item.filename}>
                      {item.filename}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between font-mono text-[10px] text-text-3">
                  <span>{item.width !== null ? `${item.width}×${item.height}` : ""}</span>
                  <span>{formatBytes(item.sizeBytes ?? 0)}</span>
                </div>
                {trashMode && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      disabled={busyId !== null}
                      className="cursor-pointer text-accent hover:underline disabled:opacity-50"
                      onClick={() => void trashAction(item.id, "restore")}
                    >
                      {busyId === item.id ? "处理中…" : "恢复"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId !== null}
                      className="cursor-pointer text-red hover:underline disabled:opacity-50"
                      onClick={() => void trashAction(item.id, "purge")}
                    >
                      立即清除
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="rounded-md border border-line bg-panel px-4 py-10 text-center text-xs text-text-3">
          没有符合条件的媒体
        </div>
      )}

      {openId !== null && (
        <MediaDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onDeleted={() => {
            setOpenId(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
