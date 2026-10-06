"use client";

/**
 * 封面设置弹窗(M5-d 起步;M14 批⑤对齐原型 admin-cover「一次裁剪·多尺寸导出」):
 * 三源选图(本地上传 / 媒体库选用 / AI 文生图——M16 提为第三源,未选源首屏即可
 * 直达生成)→ 左裁剪器(react-easy-crop 拖拽/缩放/旋转)→ 右模板卡(激活卡定
 * 裁剪比例,勾选定导出集)→ 导出队列(逐模板 cover-fit canvas 导出上传,行级状态)
 * → OG 变体 onSet。本弹窗即走 POST /api/media,导出即入库(原型「存入媒体库」
 * 按钮由此天然满足,不再单列)。
 */
import { useEffect, useRef, useState } from "react";
import type { Area } from "react-easy-crop";

import CropStage from "./cover/CropStage";
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
import { type ApiEnvelope } from "@/lib/http/response";

type QueueState = "pending" | "running" | "done" | "failed";

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

type GenPhase = "idle" | "queued" | "running" | "done" | "failed";

interface GenState {
  phase: GenPhase;
  jobId: string | null;
  token: string | null;
  error: string | null;
}

const GEN_IDLE: GenState = { phase: "idle", jobId: null, token: null, error: null };

/** 轮询节奏与上限(2.5s × 48 ≈ 2 分钟;生图典型 10-30s) */
const GEN_POLL_MS = 2500;
const GEN_POLL_MAX_TICKS = 48;

export default function CoverDialog({
  onClose,
  onSet,
  coverContext,
}: {
  onClose: () => void;
  onSet: (path: string) => void;
  /** AI 文生图上下文(编辑器透传;缺省不出 AI 生图入口) */
  coverContext?: CoverGenContext;
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
  const [gen, setGen] = useState<GenState>(GEN_IDLE);
  const [candidates, setCandidates] = useState<Array<{ id: string; path: string }>>([]);
  /** 未选源首屏的 AI 生成面板展开态(M16:AI 提为第三源,点卡展开) */
  const [aiOpen, setAiOpen] = useState(false);
  const genPollRef = useRef<number | null>(null);

  const genRunning = gen.phase === "queued" || gen.phase === "running";

  // 卸载/关弹窗停轮询
  useEffect(() => {
    return () => {
      if (genPollRef.current !== null) window.clearInterval(genPollRef.current);
    };
  }, []);

  function stopGenPoll(): void {
    if (genPollRef.current !== null) {
      window.clearInterval(genPollRef.current);
      genPollRef.current = null;
    }
  }

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

  const pendingCount = COVER_TEMPLATES.filter((t) => checked.has(t.key)).length;

  /** AI 文生图(M14 批⑥):入队 → 2.5s 轮询 → 候选点选即设为封面 */
  async function pollGen(jobId: string, token: string, tickRef: { n: number }): Promise<void> {
    tickRef.n += 1;
    if (tickRef.n > GEN_POLL_MAX_TICKS) {
      stopGenPoll();
      setGen({ ...GEN_IDLE, phase: "failed", error: "生成超时(后台仍在跑,稍后可重试取候选)" });
      return;
    }
    try {
      const res = await fetch(
        `/api/posts/cover-generate/${jobId}?token=${encodeURIComponent(token)}`,
      );
      const json = (await res.json()) as ApiEnvelope<{
        state: "waiting" | "active" | "completed" | "failed";
        error: string | null;
        candidates: Array<{ id: string; path: string }>;
      }>;
      if (json.code !== 0 || !json.data) {
        stopGenPoll();
        setGen({ ...GEN_IDLE, phase: "failed", error: json.message || `查询失败(${res.status})` });
        return;
      }
      setCandidates(json.data.candidates.map((c) => ({ id: c.id, path: c.path })));
      if (json.data.state === "completed") {
        stopGenPoll();
        if (json.data.candidates.length === 0) {
          setGen({ ...GEN_IDLE, phase: "failed", error: "生成完成但没有产出候选,请重试" });
        } else {
          setGen({ ...GEN_IDLE, phase: "done" });
        }
        return;
      }
      if (json.data.state === "failed") {
        stopGenPoll();
        setGen({ ...GEN_IDLE, phase: "failed", error: json.data.error ?? "生成失败,请重试" });
        return;
      }
      setGen({ phase: "running", jobId, token, error: null });
    } catch {
      // 单次网络抖动不中断轮询,交由上限兜底
    }
  }

  async function startGen(): Promise<void> {
    if (!coverContext || coverContext.title.trim() === "") return;
    stopGenPoll();
    setGen({ phase: "queued", jobId: null, token: null, error: null });
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/posts/cover-generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: coverContext.title,
          excerpt: coverContext.excerpt,
          tags: coverContext.tags,
        }),
      });
      const json = (await res.json()) as ApiEnvelope<{ jobId: string; token: string }>;
      if (json.code !== 0 || !json.data) {
        setGen({ ...GEN_IDLE, phase: "failed", error: json.message || `提交失败(${res.status})` });
        return;
      }
      const tickRef = { n: 0 };
      genPollRef.current = window.setInterval(
        () => void pollGen(json.data!.jobId, json.data!.token, tickRef),
        GEN_POLL_MS,
      );
      setGen({ phase: "running", jobId: json.data.jobId, token: json.data.token, error: null });
    } catch {
      setGen({ ...GEN_IDLE, phase: "failed", error: "网络错误,请重试" });
    }
  }

  function adoptCandidate(path: string): void {
    onSet(path);
    setNote("已选 AI 候选设为封面,正在关闭…");
    setTimeout(onClose, 600);
  }

  /** AI 生成块内芯(M16 抽出):未选源首屏与已选源模板卡下两处复用 */
  const aiGenInner = coverContext ? (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-[11px] font-medium text-text-2">
          AI 文生图
          <span className="ml-1 font-normal text-text-3">(cover 绑定模型)</span>
        </div>
        <button
          type="button"
          disabled={genRunning || busy || coverContext.title.trim() === ""}
          title={
            coverContext.title.trim() === "" ? "先填文章标题" : "标题/摘要 → prompt,一次 2 张候选"
          }
          onClick={() => void startGen()}
          className="flex-none cursor-pointer rounded-sm border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
        >
          {genRunning ? "生成中…" : gen.phase === "done" ? "再生成一批" : "生成候选"}
        </button>
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-text-3">
        生图走后台队列约 10-30s;候选入媒体库,点选即设为封面
      </div>
      {gen.phase === "failed" && (
        <div className="mt-1 text-[10px] leading-relaxed text-red">{gen.error}</div>
      )}
      {genRunning && (
        <div className="mt-1 text-[10px] text-amber">生成中…已出 {candidates.length} 张</div>
      )}
      {candidates.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              title="点选设为封面"
              onClick={() => adoptCandidate(c.path)}
              className="cursor-pointer overflow-hidden rounded-sm border border-line hover:border-accent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 管理端候选预览,src 为站内路径 */}
              <img
                src={c.path}
                alt="AI 生成封面候选"
                loading="lazy"
                className="h-16 w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </>
  ) : null;

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
          <>
            {/* 三源并列(M16:AI 文生图提为第三源,新建未选源也可直接生成) */}
            <div
              className={`mt-4 grid gap-3 ${coverContext ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
            >
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-line text-text-3 hover:border-accent hover:text-accent"
              >
                <svg className="ic-lg" aria-hidden="true">
                  <use href="#i-cloudupload" />
                </svg>
                <span className="text-xs">本地上传(jpg / png / webp)</span>
                <span className="text-[11px]">将按模板比例交互裁剪</span>
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-line text-text-3 hover:border-accent hover:text-accent"
              >
                <svg className="ic-lg" aria-hidden="true">
                  <use href="#i-picture" />
                </svg>
                <span className="text-xs">从媒体库选图</span>
                <span className="text-[11px]">复用已上传素材,无需重复占用空间</span>
              </button>
              {coverContext && (
                <button
                  type="button"
                  aria-expanded={aiOpen}
                  onClick={() => setAiOpen((v) => !v)}
                  className={`flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed text-text-3 hover:border-accent hover:text-accent ${
                    aiOpen ? "border-accent text-accent" : "border-line"
                  }`}
                >
                  <svg className="ic-lg" aria-hidden="true">
                    <use href="#i-robot" />
                  </svg>
                  <span className="text-xs">AI 生成封面</span>
                  <span className="text-[11px]">标题/摘要 → prompt,无需先备图</span>
                </button>
              )}
            </div>
            {coverContext && aiOpen && (
              <div className="mt-3 rounded-sm border border-line bg-panel-2 p-3">{aiGenInner}</div>
            )}
          </>
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
                <div className="text-xs font-medium text-text-2">裁剪模板</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {COVER_TEMPLATES.map((t) => (
                    <div
                      key={t.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveKey(t.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setActiveKey(t.key);
                      }}
                      className={`relative cursor-pointer rounded-sm border p-1.5 ${
                        activeKey === t.key
                          ? "border-accent"
                          : "border-line hover:border-line-hover"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="block w-full rounded-sm border border-line bg-panel-2 bg-center"
                        style={{
                          aspectRatio: `${t.w} / ${t.h}`,
                          backgroundImage: `url(${source.url})`,
                          backgroundSize: "cover",
                        }}
                      />
                      <div className="mt-1 flex items-start gap-1">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[var(--accent)]"
                          checked={checked.has(t.key)}
                          onChange={() => toggleCheck(t.key)}
                          disabled={busy}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium text-text-1">
                            {t.label}
                          </div>
                          <div className="truncate font-mono text-[10px] text-text-3">
                            {t.w}×{t.h}
                          </div>
                        </div>
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-text-3" title={t.use}>
                        {t.use}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[10px] leading-relaxed text-text-3">
                  点卡切换裁剪比例;勾选卡进导出集(多尺寸从同一选区 cover-fit 适配)
                </div>

                {/* AI 文生图行(原型 admin-cover ai-row;M16 抽 aiGenInner 与未选源首屏共用) */}
                {coverContext && <div className="mt-3 border-t border-line pt-3">{aiGenInner}</div>}
              </div>

              <div className="rounded-md border border-line bg-panel p-3">
                <div className="text-xs font-medium text-text-2">导出队列</div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {COVER_TEMPLATES.filter((t) => checked.has(t.key)).map((t) => {
                    const st = queue[t.key];
                    return (
                      <li key={t.key} className="flex items-center gap-2 text-[11px]">
                        <span
                          className={`w-14 flex-none rounded-sm px-1 py-px text-center text-[10px] ${
                            st === "done"
                              ? "bg-green/10 text-green"
                              : st === "failed"
                                ? "bg-red/10 text-red"
                                : st === "running"
                                  ? "bg-amber/10 text-amber"
                                  : "bg-panel-2 text-text-3"
                          }`}
                        >
                          {st === "done"
                            ? "已导出"
                            : st === "failed"
                              ? "失败"
                              : st === "running"
                                ? "处理中"
                                : "待导出"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-text-2">{t.label}</span>
                        <span className="flex-none font-mono text-text-3">
                          {t.w}×{t.h}
                        </span>
                      </li>
                    );
                  })}
                  {pendingCount === 0 && (
                    <li className="text-[11px] text-text-3">未勾选任何模板</li>
                  )}
                </ul>
                <button
                  type="button"
                  disabled={busy || pendingCount === 0 || !areaPx}
                  onClick={() => void generate()}
                  className="mt-3 w-full cursor-pointer rounded-sm bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "导出上传中…" : `⤓ 按模板一键导出 ${pendingCount} 尺寸`}
                </button>
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
