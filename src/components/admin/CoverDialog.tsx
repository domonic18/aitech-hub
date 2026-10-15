"use client";

/**
 * 封面设置弹窗(M5-d 起步;M14 批⑤对齐原型 admin-cover「一次裁剪·多尺寸导出」):
 * 三源选图(本地上传 / 媒体库选用 / AI 生成)→ 左裁剪器(react-easy-crop 拖拽/
 * 缩放/旋转)→ 右模板卡(激活卡定裁剪比例,勾选定导出集)→ 导出队列(逐模板
 * cover-fit canvas 导出上传,行级状态)→ OG 变体 onSet。三源卡/模板网格/导出
 * 队列已拆 cover/ 子件(技术债批③),本件留编排与画布逻辑。AI 生成(M31 验收
 * 反馈 agent 化):弹窗内不再有直连生图面——入口唤起编辑页侧边栏 Agent
 * (ask_user 对齐方向 → 生成候选 → 预览卡确认后才入库)。本弹窗即走 POST
 * /api/media,导出即入库。
 */
import { useEffect, useRef, useState } from "react";
import type { Area } from "react-easy-crop";

import CropStage from "./cover/CropStage";
import CoverAgentEntry from "./cover/CoverAgentEntry";
import CoverExportQueue, { type QueueState } from "./cover/CoverExportQueue";
import CoverSourcePicker from "./cover/CoverSourcePicker";
import CoverTemplateGrid from "./cover/CoverTemplateGrid";
import MediaPicker, { type PickItem } from "./cover/MediaPicker";
import {
  aspectOf,
  canvasToBlob,
  cropToCanvas,
  COVER_TEMPLATES,
  drawCover,
  type CoverGenContext,
  OG_KEY,
  rotateToCanvas,
} from "./cover/templates";
import { MEDIA_LIMITS } from "@/lib/media/media-schema";
import { uploadImageFile } from "@/lib/media/upload-client";

interface SourceImage {
  bmp: ImageBitmap;
  /** react-easy-crop 的 image src(blob URL 或站内路径,均同源可绘) */
  url: string;
  /** 来源说明(页头展示) */
  label: string;
  /** 本地来源的 blob URL(换源时 revoke;媒体库来源为 null 不动站内路径) */
  objectUrl: string | null;
}

async function fetchMediaAsSource(item: PickItem): Promise<SourceImage> {
  const res = await fetch(item.path);
  if (!res.ok) throw new Error(`媒体加载失败(${res.status})`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  return { bmp, url: item.path, label: item.filename, objectUrl: null };
}

export default function CoverDialog({
  onClose,
  onSet,
  coverContext,
  onAgentCoverGen,
}: {
  onClose: () => void;
  onSet: (path: string) => void;
  /** AI 生成上下文(编辑器透传;缺省不出 AI 生成入口) */
  coverContext?: CoverGenContext;
  /** M31:唤起编辑页侧边栏 Agent 走封面生成流程(缺省不出 AI 生成入口) */
  onAgentCoverGen?: () => void;
}): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [activeKey, setActiveKey] = useState<string>(OG_KEY);
  const [checked, setChecked] = useState<Set<string>>(
    new Set(COVER_TEMPLATES.filter((t) => t.defaultOn).map((t) => t.key)),
  );
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [areaPx, setAreaPx] = useState<Area | null>(null);
  const [queue, setQueue] = useState<Record<string, QueueState>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const activeTemplate = COVER_TEMPLATES.find((t) => t.key === activeKey) ?? COVER_TEMPLATES[1];

  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (!pickerOpen && e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose, pickerOpen]);

  // 换源回收本地 blob URL(站内路径不回收)
  useEffect(() => {
    if (!source) return;
    return () => {
      if (source.objectUrl) URL.revokeObjectURL(source.objectUrl);
    };
  }, [source]);

  function toggleCheck(key: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function resetFor(source: SourceImage): void {
    setSource(source);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setAreaPx(null);
    setQueue({});
    setError(null);
    setNote(null);
  }

  function pickLocal(f: File): void {
    setError(null);
    setNote(null);
    if (f.size > MEDIA_LIMITS.maxUploadBytes) {
      setError(`图片超过 ${MEDIA_LIMITS.maxUploadBytes / 1024 / 1024}MB,请压缩后重试`);
      return;
    }
    const objectUrl = URL.createObjectURL(f);
    void createImageBitmap(f)
      .then((bmp) => resetFor({ bmp, url: objectUrl, label: f.name, objectUrl }))
      .catch(() => {
        URL.revokeObjectURL(objectUrl);
        setError("图片解码失败,请换一张图");
      });
  }

  function pickFromMedia(item: PickItem): void {
    setPickerOpen(false);
    setError(null);
    setNote(null);
    void fetchMediaAsSource(item)
      .then(resetFor)
      .catch((e) => setError(e instanceof Error ? e.message : "媒体加载失败"));
  }

  async function uploadTemplate(
    src: HTMLCanvasElement | ImageBitmap,
    t: (typeof COVER_TEMPLATES)[number],
  ): Promise<string | null> {
    const canvas = document.createElement("canvas");
    drawCover(src, canvas, t);
    const blob = await canvasToBlob(canvas);
    const ext = blob.type === "image/webp" ? "webp" : "png";
    const file = new File([blob], `cover-${t.key}.${ext}`, { type: blob.type || "image/png" });
    const r = await uploadImageFile(file, file.name);
    return r.ok ? r.path : null;
  }

  async function generate(): Promise<void> {
    if (!source || !areaPx) return;
    const templates = COVER_TEMPLATES.filter((t) => checked.has(t.key));
    if (templates.length === 0) {
      setError("至少勾选一个尺寸模板");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    setQueue(Object.fromEntries(templates.map((t) => [t.key, "pending" as QueueState])));
    try {
      // 选区坐标相对旋转后图幅:先展开包围盒再切主图,多尺寸从主图 cover-fit 适配
      const rotated = rotateToCanvas(source.bmp, rotation);
      const cropped = cropToCanvas(rotated ?? source.bmp, areaPx);
      const out = new Map<string, string>();
      for (const t of templates) {
        setQueue((q) => ({ ...q, [t.key]: "running" }));
        try {
          const path = await uploadTemplate(cropped, t);
          if (path) {
            out.set(t.key, path);
            setQueue((q) => ({ ...q, [t.key]: "done" }));
          } else {
            setQueue((q) => ({ ...q, [t.key]: "failed" }));
          }
        } catch {
          setQueue((q) => ({ ...q, [t.key]: "failed" }));
        }
      }
      const ogPath = out.get(OG_KEY) ?? [...out.values()][0] ?? null;
      if (!ogPath) {
        setError("导出上传失败,请重试(封面未变更)");
        return;
      }
      onSet(ogPath);
      if (out.size === templates.length) {
        setNote("封面已设置,正在关闭…");
        setTimeout(onClose, 600);
      } else {
        setNote(
          `封面已设为 ${out.get(OG_KEY) ? "OG" : "首个成功"} 变体,${out.size}/${templates.length} 张导出成功`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  /** AI 生成入口(唤起侧边栏 Agent 走 ask_user 对齐方向 → 候选确认入库) */
  const launchAgent = (): void => {
    onAgentCoverGen?.();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[86vh] w-full max-w-[880px] overflow-y-auto rounded-md border border-line bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            设置封面
            <span className="ml-2 font-mono text-[11px] font-normal text-text-3">
              一次裁剪 · 多尺寸导出
            </span>
          </h3>
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
            if (f) pickLocal(f);
            e.target.value = "";
          }}
        />

        {!source ? (
          <CoverSourcePicker
            hasAgent={!!coverContext}
            onLocal={() => fileRef.current?.click()}
            onMedia={() => setPickerOpen(true)}
            onAgent={launchAgent}
          />
        ) : (
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[1fr_300px]">
            {/* 左:裁剪器 */}
            <div className="rounded-md border border-line bg-panel p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] text-text-3">
                <span>
                  源图:{source.label}
                  {source.bmp && (
                    <span className="ml-1 font-mono">
                      {source.bmp.width}×{source.bmp.height}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    className="cursor-pointer rounded-sm border border-line px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
                  >
                    本地上传
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPickerOpen(true)}
                    className="cursor-pointer rounded-sm border border-line px-2 py-1 text-text-2 hover:bg-panel-2 disabled:opacity-50"
                  >
                    媒体库
                  </button>
                </span>
              </div>
              <CropStage
                url={source.url}
                aspect={aspectOf(activeTemplate)}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                areaPx={areaPx}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onRotationChange={setRotation}
                onCropComplete={setAreaPx}
              />
            </div>

            {/* 右:模板 + 导出队列 */}
            <div className="flex flex-col gap-4">
              <div className="rounded-md border border-line bg-panel p-3">
                <CoverTemplateGrid
                  sourceUrl={source.url}
                  activeKey={activeKey}
                  onActivate={setActiveKey}
                  checked={checked}
                  onToggleCheck={toggleCheck}
                  busy={busy}
                />
                {/* AI 生成入口(agent 唤起) */}
                {coverContext && (
                  <div className="mt-3 border-t border-line pt-3">
                    <CoverAgentEntry onLaunch={launchAgent} />
                  </div>
                )}
              </div>

              <div className="rounded-md border border-line bg-panel p-3">
                <CoverExportQueue
                  checked={checked}
                  queue={queue}
                  busy={busy}
                  canGenerate={!!areaPx}
                  onGenerate={() => void generate()}
                />
              </div>
            </div>
          </div>
        )}

        {error && <div className="mt-3 text-xs text-red">{error}</div>}
        {note && <div className="mt-3 text-xs text-accent">{note}</div>}
        <p className="mt-4 font-mono text-[10px] leading-relaxed text-text-3">
          canvas 裁剪 → 各尺寸按 cover 变体 POST /api/media 入库(sharp 出 webp 缩略图)→ OG
          变体回填文章封面; 导出即入媒体库,无需重复上传。
        </p>
      </div>
      {pickerOpen && <MediaPicker onPick={pickFromMedia} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
