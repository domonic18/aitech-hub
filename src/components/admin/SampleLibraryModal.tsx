"use client";

/**
 * 样例图库管理弹层(Ardot F8 定稿,创作域对齐批 2026-10-23):
 * writing_sample_image 行治理的图形入口——清单 / 添加本地图 / 剪贴板粘贴 /
 * 行内重命名 / 删除。全库自动作为每个创作的预置参照候选(参照轨内显示
 * 最新 5 张);删除仅移出图库并解绑已绑创作,媒体文件不连带(sha1 去重、
 * 可能被正文引用)。改动即落库;关闭时若有变更 router.refresh() 联动
 * 服务端候选(参照轨 / 工坊列表),调用方零胶水。
 * 上传直走 POST /api/writing-samples(multipart 字段 file,≤6MB 帽,
 * 名称缺省取文件名去扩展),无需两步入库;粘贴监听仅弹层打开时注册,
 * 目标在输入框(重命名中)或无可粘贴图片时不接管,同 ReferenceRail 口径。
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import { IMAGE_ACCEPT } from "@/lib/media/media-schema";

/** 与 lib/topics/writing-samples 的 WritingSampleDto 同形(本地声明,避免客户端引服务模块) */
interface SampleRow {
  id: string;
  name: string;
  mediaPath: string;
  createdAt: string;
}

/** envelope 口径:{code,message,data};code=0 成功(上传 202 受理也算) */
function envelopeError(j: { code: number; message: string }, status: number): Error {
  return new Error(j.message || `请求失败(${status})`);
}

export default function SampleLibraryModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** 本开窗内有过增删改名 → 关闭时刷新服务端候选 */
  const dirtyRef = useRef(false);
  const [rows, setRows] = useState<SampleRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 行内重命名态(id + 输入值);null = 无行在改名 */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      const res = await fetch("/api/writing-samples");
      const j = (await res.json()) as {
        code: number;
        message: string;
        data: { samples: SampleRow[] } | null;
      };
      if (j.code !== 0) throw envelopeError(j, res.status);
      setRows(j.data?.samples ?? []);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "清单加载失败");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  function close(): void {
    if (dirtyRef.current) router.refresh();
    onClose();
  }

  async function upload(file: Blob, filename: string): Promise<void> {
    if (uploading) return;
    setErr(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file, filename);
      const res = await fetch("/api/writing-samples", { method: "POST", body: fd });
      const j = (await res.json()) as { code: number; message: string };
      if (j.code !== 0) throw envelopeError(j, res.status);
      dirtyRef.current = true;
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  // 剪贴板图片 → 直传图库;弹层未开/重命名输入中/目标可编辑时不接管
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent): void => {
      if (uploading || renaming) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")
      ) {
        return;
      }
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      void upload(file, file.name || "paste.png");
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  async function submitRename(): Promise<void> {
    if (!renaming) return;
    const name = renaming.value.trim();
    if (!name) {
      setErr("名称必填");
      return;
    }
    setErr(null);
    setBusyId(renaming.id);
    try {
      const res = await fetch(`/api/writing-samples/${renaming.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = (await res.json()) as { code: number; message: string };
      if (j.code !== 0) throw envelopeError(j, res.status);
      dirtyRef.current = true;
      setRenaming(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "重命名失败");
    } finally {
      setBusyId(null);
    }
  }

  async function del(row: SampleRow): Promise<void> {
    if (!window.confirm(`删除样例「${row.name}」?已绑创作将自动解绑,媒体文件保留。`)) return;
    setErr(null);
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/writing-samples/${row.id}`, { method: "DELETE" });
      const j = (await res.json()) as { code: number; message: string };
      if (j.code !== 0) throw envelopeError(j, res.status);
      dirtyRef.current = true;
      if (renaming?.id === row.id) setRenaming(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return (
    <DialogShell width="2xl" scroll>
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">样例图库管理</h3>
          <p className="mt-0.5 text-[11px] text-text-3">
            全库作为每个创作的预置参照候选 · 参照轨内显示最新 5 张
          </p>
        </div>
        <button
          type="button"
          aria-label="关闭"
          onClick={close}
          className="ml-auto cursor-pointer rounded-sm p-1 text-text-2 hover:bg-panel-2 hover:text-text-1"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-close" />
          </svg>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="flex cursor-pointer items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-plus" />
          </svg>
          {uploading ? "上传中…" : "添加本地图"}
        </button>
        <span className="rounded-sm border border-line px-2 py-1 text-xs text-text-2">
          Ctrl+V 粘贴
        </span>
        <span className="ml-auto text-[11px] text-text-3">
          删除仅移出图库,不删媒体文件 · 已绑创作的参照自动解绑
        </span>
      </div>

      {loadErr && (
        <p className="mt-3 text-xs text-red" role="alert">
          清单加载失败:{loadErr}
        </p>
      )}
      {loaded && !loadErr && rows.length === 0 && (
        <p className="mt-3 text-xs text-text-3">
          图库为空——上传或粘贴第一张样例图,即可作为所有创作的预置参照候选。
        </p>
      )}

      <div className="mt-3 grid grid-cols-5 gap-2">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`overflow-hidden rounded-sm border border-line ${
              busyId === row.id ? "opacity-50" : ""
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部缩略,src 为站内动态路径 */}
            <img
              src={row.mediaPath}
              alt={row.name}
              loading="lazy"
              className="h-24 w-full bg-panel-2 object-cover"
            />
            <div className="p-1.5">
              {renaming?.id === row.id ? (
                <input
                  autoFocus
                  value={renaming.value}
                  aria-label="重命名样例图"
                  onChange={(e) => setRenaming({ id: row.id, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-full rounded-sm border border-accent bg-panel-2 px-1 py-0.5 text-[11px] text-text-1 outline-none"
                />
              ) : (
                <p className="truncate text-[11px] text-text-1" title={row.name}>
                  {row.name}
                </p>
              )}
              <div className="mt-1 flex gap-1.5">
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => setRenaming({ id: row.id, value: row.name })}
                  className="cursor-pointer text-[10px] text-text-3 hover:text-accent disabled:opacity-50"
                >
                  重命名
                </button>
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void del(row)}
                  className="cursor-pointer text-[10px] text-text-3 hover:text-red disabled:opacity-50"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-line text-text-3 hover:border-text-3 hover:text-text-2 disabled:opacity-50"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-plus" />
          </svg>
          <span className="text-[11px]">上传 / 粘贴添加</span>
        </button>
      </div>

      {err && (
        <p className="mt-3 text-xs text-red" role="alert">
          {err}
        </p>
      )}
      <p className="mt-3 text-[11px] text-text-3">
        改动即时生效——参照轨候选自动刷新,新图自动进入所有创作的预置候选
      </p>
      <DialogActions>
        <button
          type="button"
          onClick={close}
          className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:text-text-1"
        >
          关闭
        </button>
      </DialogActions>

      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        aria-label="添加本地图入库"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f, f.name);
        }}
      />
    </DialogShell>
  );
}
