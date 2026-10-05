"use client";

/**
 * 封面设置弹窗(M5-d 用户反馈:右侧栏只留 WP 式封面卡,尺寸/裁剪工作流入弹窗):
 * 选源图 → canvas cover-fit 居中裁剪实时预览各尺寸模板 → 勾选导出集 →
 * 逐张 POST /api/media 入库 → coverPath 取 OG 变体。Esc/遮罩点击/✕ 均可关闭。
 */
import { useEffect, useRef, useState } from "react";

import { MEDIA_LIMITS } from "@/lib/media/media-schema";
import { uploadImageFile } from "@/lib/media/upload-client";

interface CoverTemplate {
  key: string;
  label: string;
  w: number;
  h: number;
}

const COVER_TEMPLATES: ReadonlyArray<CoverTemplate & { defaultOn?: boolean }> = [
  { key: "og", label: "OG 1200×630(前台/分享主图)", w: 1200, h: 630, defaultOn: true },
  { key: "wechat", label: "微信 900×383", w: 900, h: 383 },
  { key: "csdn", label: "CSDN 1024×576", w: 1024, h: 576 },
  { key: "thumb", label: "缩略 480×270", w: 480, h: 270 },
];

const OG_KEY = "og";

/** canvas 导出质量(canvas 编码器,与 worker sharp 的 MEDIA_LIMITS.webpQuality 相互独立) */
const CANVAS_WEBP_QUALITY = 0.85;

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas toBlob failed"))),
      "image/webp",
      CANVAS_WEBP_QUALITY,
    );
  });
}

/** cover-fit 居中裁剪:目标画布铺满,源图等比缩放后取中央 */
function drawCover(bmp: ImageBitmap, canvas: HTMLCanvasElement, t: CoverTemplate): void {
  canvas.width = t.w;
  canvas.height = t.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  const scale = Math.max(t.w / bmp.width, t.h / bmp.height);
  const sw = t.w / scale;
  const sh = t.h / scale;
  ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, t.w, t.h);
}

async function uploadBlob(blob: Blob, filename: string): Promise<string | null> {
  // File 包装保留 mime 兜底(blob.type 为空时按 png,服务端白名单显式拒绝)
  const file = new File([blob], filename, { type: blob.type || "image/png" });
  const r = await uploadImageFile(file, filename);
  return r.ok ? r.path : null;
}

export default function CoverDialog({
  onClose,
  onSet,
}: {
  onClose: () => void;
  onSet: (path: string) => void;
}): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [source, setSource] = useState<{ file: File; url: string; bmp: ImageBitmap } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(
    new Set(COVER_TEMPLATES.filter((t) => t.defaultOn).map((t) => t.key)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** key 作身份(label 是展示文案,改文案不影响逻辑匹配) */
  const [results, setResults] = useState<
    Array<{ key: string; label: string; path: string | null }>
  >([]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  // 源图变化 → 重绘各模板实时裁剪预览(canvas 位图与模板同比例,CSS 缩放不失真)
  useEffect(() => {
    if (!source) return;
    for (const t of COVER_TEMPLATES) {
      const c = canvasRefs.current.get(t.key);
      if (c) drawCover(source.bmp, c, t);
    }
    return () => URL.revokeObjectURL(source.url);
  }, [source]);

  function toggle(key: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function pick(f: File): void {
    setError(null);
    setNote(null);
    setResults([]);
    if (f.size > MEDIA_LIMITS.maxUploadBytes) {
      setError(`图片超过 ${MEDIA_LIMITS.maxUploadBytes / 1024 / 1024}MB,请压缩后重试`);
      return;
    }
    void createImageBitmap(f)
      .then((bmp) => setSource({ file: f, url: URL.createObjectURL(f), bmp }))
      .catch(() => setError("图片解码失败,请换一张图"));
  }

  async function generate(): Promise<void> {
    if (!source) return;
    const templates = COVER_TEMPLATES.filter((t) => checked.has(t.key));
    if (templates.length === 0) {
      setError("至少勾选一个尺寸模板");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    setResults([]);
    const out: Array<{ key: string; label: string; path: string | null }> = [];
    for (const t of templates) {
      try {
        const canvas = document.createElement("canvas");
        drawCover(source.bmp, canvas, t);
        const blob = await canvasToBlob(canvas);
        const ext = blob.type === "image/webp" ? "webp" : "png";
        const path = await uploadBlob(blob, `cover-${t.key}.${ext}`);
        out.push({ key: t.key, label: t.label, path });
      } catch {
        out.push({ key: t.key, label: t.label, path: null });
      }
      setResults([...out]);
    }
    setBusy(false);
    const og = out.find((r) => r.key === OG_KEY);
    const okCount = out.filter((r) => r.path).length;
    if (!og?.path) {
      setError("封面上传失败,请重试(封面未变更)");
      return;
    }
    onSet(og.path);
    if (okCount === out.length) {
      setNote("封面已设置,正在关闭…");
      setTimeout(onClose, 600);
    } else {
      setNote(`封面已设为 OG 变体,${okCount}/${out.length} 张导出成功(失败项可重试)`);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-md border border-line bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">设置封面</h3>
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

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pick(f);
            e.target.value = "";
          }}
        />

        {!source ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-4 flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-line text-text-3 hover:border-accent hover:text-accent"
          >
            <svg className="ic-lg" aria-hidden="true">
              <use href="#i-picture" />
            </svg>
            <span className="text-xs">选择图片(jpg / png / webp)</span>
            <span className="text-[11px] text-text-3">将按所选尺寸模板自动居中裁剪</span>
          </button>
        ) : (
          <>
            <div className="mt-4 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- 管理端内部预览,src 为本地 blob URL */}
              <img
                src={source.url}
                alt="源图预览"
                className="max-h-40 max-w-[60%] rounded-sm border border-line object-contain"
              />
              <div className="flex flex-col gap-2 text-[11px] text-text-3">
                <span>
                  原图 {source.bmp.width}×{source.bmp.height}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                  className="cursor-pointer self-start rounded-sm border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-60"
                >
                  重选图片
                </button>
              </div>
            </div>

            <div className="mt-4 text-xs font-medium text-text-2">
              尺寸模板(勾选导出;预览即裁剪效果)
            </div>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {COVER_TEMPLATES.map((t) => (
                <label
                  key={t.key}
                  className={`cursor-pointer rounded-sm border p-2 ${
                    checked.has(t.key) ? "border-accent" : "border-line opacity-60"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[11px] text-text-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={checked.has(t.key)}
                      onChange={() => toggle(t.key)}
                      disabled={busy}
                    />
                    {t.label}
                  </span>
                  <canvas
                    ref={(c) => {
                      if (c) canvasRefs.current.set(t.key, c);
                      else canvasRefs.current.delete(t.key);
                    }}
                    className="mt-1.5 h-20 w-full rounded-sm border border-line bg-panel-2"
                  />
                </label>
              ))}
            </div>
          </>
        )}

        {error && <div className="mt-3 text-xs text-red">{error}</div>}
        {note && <div className="mt-3 text-xs text-accent">{note}</div>}
        {results.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {results.map((r) => (
              <li key={r.key} className="flex items-center gap-1.5 text-[11px]">
                <span className={r.path ? "text-accent" : "text-red"}>{r.path ? "✓" : "✗"}</span>
                <span className="text-text-2">{r.label}</span>
                {!r.path && <span className="text-text-3">导出失败</span>}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={busy || !source}
            onClick={() => void generate()}
            className="cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "生成上传中…" : "生成并设为封面"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-sm border border-line px-4 py-2 text-sm text-text-2 hover:text-text-1"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
