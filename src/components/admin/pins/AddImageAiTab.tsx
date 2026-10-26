"use client";

/**
 * 添加图片·AI 生成 tab(M47 批D 自 AddImageModal 切出,三 tab 各自持态):
 * prompt+参照图+尺寸+张数 → POST generate 入队,完成后回调交编排层轮询。
 * 参照图(M42 批③,风格锚定,单张)只收站内 uploads:工坊根版本或本地上传。
 */
import { useRef, useState } from "react";

import { ILLUSTRATE_ASPECT_OPTIONS } from "@/lib/ai/constants";
import { uploadImageFile } from "@/lib/media/upload-client";
import { DialogActions } from "@/components/admin/DialogShell";

import { callPinApi, JSON_HEADERS } from "./api";
import type { WorkshopRootOption } from "./PinEditor";

const ASPECTS = ILLUSTRATE_ASPECT_OPTIONS;

export default function AddImageAiTab({
  pinId,
  workshopRoots,
  currentCount,
  remaining,
  setError,
  onGenerated,
  onClose,
}: {
  pinId: string;
  workshopRoots: WorkshopRootOption[];
  currentCount: number;
  remaining: number;
  setError: (msg: string | null) => void;
  onGenerated: (baseline: number) => void;
  onClose: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<string>("3:4");
  const [count, setCount] = useState(1);
  // M42 批③:参照图(风格锚定,单张)——工坊根版本或本地上传,只收站内 uploads
  const [referencePath, setReferencePath] = useState<string | null>(null);
  const refFileRef = useRef<HTMLInputElement>(null);
  const [refBusy, setRefBusy] = useState(false);

  /** 本地参照图:only 过媒体管线(不挂序列),拿站内路径当 referencePath */
  async function uploadReference() {
    const file = refFileRef.current?.files?.[0];
    if (!file) return;
    setRefBusy(true);
    setError(null);
    const up = await uploadImageFile(file, file.name);
    if (!up.ok) setError(up.error);
    else setReferencePath(up.path);
    setRefBusy(false);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    const body = await callPinApi<{ jobId: string }>(`/api/pins/${pinId}/generate`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: prompt.trim(),
        aspect,
        count: Math.min(count, remaining),
        ...(referencePath ? { referencePath } : {}),
      }),
    });
    setBusy(false);
    if (body.code !== 0) setError(body.message);
    else onGenerated(currentCount);
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="出图提示词(走 illustrate 模型,工坊出图后自动挂到序列尾)…"
        className="w-full rounded-sm border border-line bg-panel-2 px-2.5 py-2 text-[13px] text-text-1 outline-none focus:border-accent"
      />
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-xs text-text-2">参照图</span>
          <span className="text-[11px] text-text-3">
            可选 · 单张 · 出图向它靠风格(prompt 里别写配色/风格词)
          </span>
          {referencePath && (
            <button
              type="button"
              onClick={() => setReferencePath(null)}
              className="ml-auto cursor-pointer text-[11px] text-text-3 hover:text-red"
            >
              清除
            </button>
          )}
        </div>
        <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setReferencePath(null)}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border text-[10.5px] ${
              referencePath === null
                ? "border-accent bg-accent-dim text-accent"
                : "border-line text-text-3 hover:text-text-1"
            }`}
          >
            无参照
          </button>
          {workshopRoots.map((v) => {
            const on = referencePath === v.mediaPath;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setReferencePath(on ? null : v.mediaPath)}
                className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-sm border ${
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
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
          <button
            type="button"
            disabled={refBusy}
            onClick={() => refFileRef.current?.click()}
            className="h-14 shrink-0 rounded-sm border border-dashed border-line px-2.5 text-[10.5px] text-text-3 hover:text-text-1 disabled:opacity-50"
          >
            {refBusy ? "上传中…" : "本地上传"}
          </button>
          <input
            ref={refFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={() => void uploadReference()}
            className="hidden"
          />
        </div>
        {referencePath && !workshopRoots.some((v) => v.mediaPath === referencePath) && (
          <p className="mt-1 truncate font-mono text-[10.5px] text-accent">参照:{referencePath}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-2">尺寸</span>
          <div className="flex overflow-hidden rounded-sm border border-line">
            {ASPECTS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setAspect(a.key)}
                className={`cursor-pointer px-2.5 py-1 text-[11px] ${
                  aspect === a.key
                    ? "bg-accent-dim font-medium text-accent"
                    : "bg-panel text-text-2 hover:text-text-1"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-2">张数</span>
          <div className="flex overflow-hidden rounded-sm border border-line">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                disabled={n > remaining}
                onClick={() => setCount(n)}
                className={`cursor-pointer px-3 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${
                  count === n
                    ? "bg-accent-dim font-medium text-accent"
                    : "bg-panel text-text-2 hover:text-text-1"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-text-3">attempts=1 计费不重试;完成后自动挂序列尾并刷新。</p>
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
          disabled={busy || !prompt.trim()}
          onClick={() => void generate()}
          className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "入队中…" : "生成"}
        </button>
      </DialogActions>
    </div>
  );
}
