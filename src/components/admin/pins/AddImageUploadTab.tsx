"use client";

/**
 * 添加图片·本地上传 tab(M47 批D 自 AddImageModal 切出,三 tab 各自持态):
 * POST /api/media 过媒体管线 → mediaPath 快照挂序列,取自然宽高。
 */
import { useRef, useState } from "react";

import { IMAGE_ACCEPT } from "@/lib/media/media-schema";
import { uploadImageFile } from "@/lib/media/upload-client";
import type { PinImageDto } from "@/lib/pins/dto";
import { DialogActions } from "@/components/admin/DialogShell";

import { callPinApi, JSON_HEADERS } from "./api";

export default function AddImageUploadTab({
  pinId,
  setError,
  onAdded,
  onClose,
}: {
  pinId: string;
  setError: (msg: string | null) => void;
  onAdded: (res: { added: number; images: PinImageDto[] }) => void;
  onClose: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  /** 本地图取自然宽高后走媒体管线,再挂序列(media_path 快照) */
  async function uploadLocal() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const up = await uploadImageFile(file, file.name);
      if (!up.ok) {
        setError(up.error);
        return;
      }
      const mediaPath = up.path;
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 0, h: 0 });
        img.src = mediaPath;
      });
      const body = await callPinApi<{ added: number; images: PinImageDto[] }>(
        `/api/pins/${pinId}/images`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            mediaPath,
            ...(dims.w > 0 ? { width: dims.w, height: dims.h } : {}),
          }),
        },
      );
      if (body.code !== 0 || !body.data) setError(body.message);
      else onAdded(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        className="w-full cursor-pointer rounded-sm border border-dashed border-line px-3 py-3 text-xs text-text-2 file:mr-3 file:cursor-pointer file:rounded-sm file:border-0 file:bg-panel-2 file:px-2.5 file:py-1.5 file:text-xs file:text-text-1"
      />
      <p className="text-[11px] text-text-3">
        {fileName ? `已选:${fileName}` : "单图 ≤10MB;jpg/png/webp/gif;过媒体管线后挂为快照"}
      </p>
      <DialogActions>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:text-text-1"
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy || !fileName}
          onClick={() => void uploadLocal()}
          className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "上传中…" : "上传并挂载"}
        </button>
      </DialogActions>
    </div>
  );
}
