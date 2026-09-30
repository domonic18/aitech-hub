"use client";

/**
 * 封面工作流(原型 admin-cover.html,M5-b):选源图 → 按模板 canvas 居中裁剪
 * (cover-fit)→ 导出各尺寸 → 逐张 POST /api/media 入库 → coverPath 取 OG 变体。
 * 模板默认勾选 OG(前台/分享主图);其余变体入库后由作者在分发平台使用(媒体库可取 URL)。
 * toBlob 不支持 webp 的浏览器自动落 PNG(上传侧按实际 mime 白名单校验)。
 */
import { useRef, useState } from "react";

interface CoverTemplate {
  key: string;
  label: string;
  w: number;
  h: number;
}

const COVER_TEMPLATES: ReadonlyArray<CoverTemplate & { defaultOn?: boolean }> = [
  { key: "og", label: "OG 1200×630", w: 1200, h: 630, defaultOn: true },
  { key: "wechat", label: "微信 900×383", w: 900, h: 383 },
  { key: "csdn", label: "CSDN 1024×576", w: 1024, h: 576 },
  { key: "thumb", label: "缩略 480×270", w: 480, h: 270 },
];

const OG_KEY = "og";

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas toBlob failed"))),
      "image/webp",
      0.85,
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
  const fd = new FormData();
  fd.set("file", new File([blob], filename, { type: blob.type || "image/png" }));
  const res = await fetch("/api/media", { method: "POST", body: fd });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { data?: { path?: string } } | null;
  return body?.data?.path ?? null;
}

export default function CoverUploader({
  coverPath,
  onChange,
}: {
  coverPath: string;
  onChange: (path: string) => void;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<Set<string>>(
    new Set(COVER_TEMPLATES.filter((t) => t.defaultOn).map((t) => t.key)),
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{ label: string; path: string | null }>>([]);

  function toggle(key: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function generate(file: File): Promise<void> {
    const templates = COVER_TEMPLATES.filter((t) => checked.has(t.key));
    if (templates.length === 0) {
      setNote("至少选择一个尺寸模板");
      return;
    }
    setBusy(true);
    setNote("生成中…");
    setResults([]);
    try {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const out: Array<{ label: string; path: string | null }> = [];
      for (const t of templates) {
        drawCover(bmp, canvas, t);
        const blob = await canvasToBlob(canvas);
        const ext = blob.type === "image/webp" ? "webp" : "png";
        const path = await uploadBlob(blob, `cover-${t.key}.${ext}`);
        out.push({ label: t.label, path });
        setResults([...out]);
      }
      bmp.close?.();
      const og = out.find((r) => r.label === COVER_TEMPLATES.find((c) => c.key === OG_KEY)?.label);
      if (og?.path) {
        onChange(og.path);
        setNote(`完成 ${out.filter((r) => r.path).length}/${out.length} 张,封面已设为 OG 变体`);
      } else {
        setNote("上传失败,请重试(封面未变更)");
      }
    } catch {
      setNote("图片解码失败,请换一张图");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-text-2" htmlFor="post-cover">
        封面
      </label>
      <input
        id="post-cover"
        value={coverPath}
        onChange={(e) => onChange(e.target.value)}
        placeholder="/wp-content/uploads/…(可手填)"
        className="w-full rounded-sm border border-line bg-panel-2 px-2 py-1.5 font-mono text-xs text-text-1 outline-none focus:border-accent"
      />
      {coverPath && (
        // eslint-disable-next-line @next/next/no-img-element -- 管理端内部预览,src 为站内动态路径
        <img
          src={coverPath}
          alt="封面预览"
          className="mt-2 h-24 w-full rounded-sm border border-line object-cover"
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {COVER_TEMPLATES.map((t) => (
          <label
            key={t.key}
            className="flex cursor-pointer items-center gap-1 text-[11px] text-text-2"
          >
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={checked.has(t.key)}
              onChange={() => toggle(t.key)}
              disabled={busy}
            />
            {t.label}
          </label>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void generate(f);
          e.target.value = "";
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="cursor-pointer rounded-sm border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-60"
        >
          {busy ? "处理中…" : "上传源图 · 按模板导出"}
        </button>
        {coverPath && !busy && (
          <button
            type="button"
            className="cursor-pointer text-xs text-red hover:underline"
            onClick={() => onChange("")}
          >
            清除封面
          </button>
        )}
      </div>
      {note && <div className="mt-1 text-[11px] text-text-3">{note}</div>}
      {results.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {results.map((r) => (
            <li key={r.label} className="truncate font-mono text-[10px]">
              <span className={r.path ? "text-accent" : "text-red"}>{r.path ? "✓" : "✗"}</span>{" "}
              <span className="text-text-3" title={r.path ?? undefined}>
                {r.path ?? `${r.label} 失败`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
