"use client";

/**
 * 添加图片·工坊选版本 tab(M47 批D 自 AddImageModal 切出,三 tab 各自持态):
 * 勾选服务端直传的工坊根版本候选多选追加(引用不拷贝)。
 */
import { useState } from "react";

import type { PinImageDto } from "@/lib/pins/dto";
import { DialogActions } from "@/components/admin/DialogShell";

import { callPinApi, JSON_HEADERS } from "./api";
import type { WorkshopRootOption } from "./PinEditor";

export default function AddImageWorkshopTab({
  pinId,
  workshopRoots,
  remaining,
  setError,
  onAdded,
  onClose,
}: {
  pinId: string;
  workshopRoots: WorkshopRootOption[];
  remaining: number;
  setError: (msg: string | null) => void;
  onAdded: (res: { added: number; images: PinImageDto[] }) => void;
  onClose: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  async function addVersions() {
    setBusy(true);
    setError(null);
    const body = await callPinApi<{ added: number; images: PinImageDto[] }>(
      `/api/pins/${pinId}/images`,
      { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ versionIds: picked }) },
    );
    setBusy(false);
    if (body.code !== 0 || !body.data) setError(body.message);
    else onAdded(body.data);
  }

  return (
    <div className="mt-3">
      {workshopRoots.length === 0 ? (
        <p className="rounded-sm border border-dashed border-line px-3 py-8 text-center text-xs text-text-3">
          工坊还没有根版本——先去「配图工坊」生成或上传首图
        </p>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-text-3">
            勾选要挂载的工坊根版本(引用不拷贝;最多再添 {remaining} 张)
          </p>
          <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
            {workshopRoots.map((v) => {
              const on = picked.includes(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    setPicked((prev) =>
                      on
                        ? prev.filter((x) => x !== v.id)
                        : prev.length >= remaining
                          ? prev
                          : [...prev, v.id],
                    )
                  }
                  className={`relative cursor-pointer overflow-hidden rounded-sm border ${
                    on
                      ? "border-accent shadow-[0_0_0_1px_var(--accent)]"
                      : "border-line hover:border-text-3"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- 站内媒体路径缩略 */}
                  <img
                    src={v.mediaPath}
                    alt=""
                    loading="lazy"
                    className="block aspect-square w-full object-cover"
                  />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 py-px text-center font-mono text-[9.5px] text-white">
                    #{v.id}
                  </span>
                  {on && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent font-mono text-[10px] text-white">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
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
              disabled={busy || picked.length === 0}
              onClick={() => void addVersions()}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "添加中…" : `添加选中(${picked.length})`}
            </button>
          </DialogActions>
        </>
      )}
    </div>
  );
}
