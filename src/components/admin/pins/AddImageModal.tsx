"use client";

/**
 * 添加图片三通道(M41):工坊选版本(服务端直传的根版本候选,多选追加)/
 * AI 生成(prompt+尺寸+张数 → POST generate 入队,完成回调交编排层轮询)/
 * 本地上传(POST /api/media 过媒体管线 → mediaPath 快照挂序列,取自然宽高)。
 */
import { useRef, useState } from "react";

import { ILLUSTRATE_ASPECT_OPTIONS } from "@/lib/ai/constants";
import { IMAGE_ACCEPT } from "@/lib/media/media-schema";
import { uploadImageFile } from "@/lib/media/upload-client";
import type { PinImageDto } from "@/lib/pins/dto";
import { PIN_IMAGES_MAX } from "@/lib/pins/constants";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

import { callPinApi, JSON_HEADERS } from "./api";
import type { WorkshopRootOption } from "./PinEditor";

const TABS = [
  { key: "workshop", label: "工坊选版本" },
  { key: "ai", label: "AI 生成" },
  { key: "upload", label: "本地上传" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const ASPECTS = ILLUSTRATE_ASPECT_OPTIONS;

export default function AddImageModal({
  pinId,
  workshopRoots,
  currentCount,
  onClose,
  onAdded,
  onGenerated,
}: {
  pinId: string;
  workshopRoots: WorkshopRootOption[];
  currentCount: number;
  onClose: () => void;
  onAdded: (res: { added: number; images: PinImageDto[] }) => void;
  onGenerated: (baseline: number) => void;
}): React.ReactElement {
  const [tab, setTab] = useState<TabKey>("workshop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<string>("3:4");
  const [count, setCount] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // M42 批③:参照图(风格锚定,单张)——工坊根版本或本地上传,只收站内 uploads
  const [referencePath, setReferencePath] = useState<string | null>(null);
  const refFileRef = useRef<HTMLInputElement>(null);
  const [refBusy, setRefBusy] = useState(false);

  const remaining = PIN_IMAGES_MAX - currentCount;

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

  const tabBtn = (key: TabKey, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        setTab(key);
        setError(null);
      }}
      className={`cursor-pointer rounded-sm px-3 py-1.5 text-xs font-medium ${
        tab === key ? "bg-accent-dim text-accent" : "text-text-2 hover:text-text-1"
      }`}
    >
      {label}
    </button>
  );

  return (
    <DialogShell title="添加图片" scroll>
      <div className="mt-3 flex items-center gap-1">
        {TABS.map((t) => tabBtn(t.key, t.label))}
        <span className="ml-auto font-mono text-[10.5px] text-text-3">
          序列 {currentCount}/{PIN_IMAGES_MAX}
        </span>
      </div>
      {error && <p className="mt-2 text-[12px] text-red">{error}</p>}
      {remaining <= 0 ? (
        <p className="py-6 text-center text-xs text-amber-hi">
          已达公众号上限 {PIN_IMAGES_MAX} 张,请先移除再添加
        </p>
      ) : (
        <>
          {tab === "workshop" && (
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
          )}

          {tab === "ai" && (
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
                  <p className="mt-1 truncate font-mono text-[10.5px] text-accent">
                    参照:{referencePath}
                  </p>
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
              <p className="text-[11px] text-text-3">
                attempts=1 计费不重试;完成后自动挂序列尾并刷新。
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
                  disabled={busy || !prompt.trim()}
                  onClick={() => void generate()}
                  className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "入队中…" : "生成"}
                </button>
              </DialogActions>
            </div>
          )}

          {tab === "upload" && (
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
          )}
        </>
      )}
    </DialogShell>
  );
}
