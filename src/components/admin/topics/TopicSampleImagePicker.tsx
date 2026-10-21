"use client";

/**
 * 样例参照图库选择器(M39 批③ §13.11):专题级「配图风格参照」绑定面——
 * 当前参照缩略 + 清除 / 本地上传(选文件 + 剪贴板粘贴)/ 图库选择弹层
 * (网格缩略 + 内联重命名 + 删除)。绑定与清除即时 PATCH topic(独立于写作
 * 要求保存按钮,免耦合);图库行治理走 /api/writing-samples;上传复用媒体库
 * (sha1 去重),参照图 ≤6MB。粘贴监听仅挂载期生效,且不劫持输入框内的
 * 粘贴(避免误把正文补充块里的图当参照)。TopicWritingConfigPanel 零改动
 * (本组件页面级挂其下方)。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiEnvelope } from "@/lib/http/response";
import type { WritingSampleDto } from "@/lib/topics/writing-samples";

const SAMPLE_MAX_BYTES = 6 * 1024 * 1024;

export default function TopicSampleImagePicker({
  topicId,
  initialSampleImageId,
}: {
  topicId: string;
  initialSampleImageId: string | null;
}) {
  const [samples, setSamples] = useState<WritingSampleDto[]>([]);
  const [boundId, setBoundId] = useState<string | null>(initialSampleImageId);
  const [showLibrary, setShowLibrary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadSamples = useCallback(async (): Promise<WritingSampleDto[]> => {
    const res = await fetch("/api/writing-samples");
    const resp = (await res.json()) as ApiEnvelope<{ samples: WritingSampleDto[] }>;
    if (res.ok && resp.code === 0) {
      setSamples(resp.data.samples);
      return resp.data.samples;
    }
    throw new Error(resp.message || `加载失败(${res.status})`);
  }, []);

  useEffect(() => {
    loadSamples().catch(() => setMsg({ tone: "err", text: "图库清单加载失败,刷新页面重试" }));
  }, [loadSamples]);

  /** 绑定/清除即时 PATCH topic(sample_image_id 可空;失败回滚本地态) */
  const patchBinding = useCallback(
    async (sampleImageId: string | null, okText: string): Promise<boolean> => {
      const prev = boundId;
      setBoundId(sampleImageId);
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch(`/api/topics/${topicId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sample_image_id: sampleImageId }),
        });
        const resp = (await res.json()) as ApiEnvelope;
        if (!res.ok || resp.code !== 0) {
          setBoundId(prev);
          setMsg({ tone: "err", text: resp.message || `操作失败(${res.status})` });
          return false;
        }
        setMsg({ tone: "ok", text: okText });
        return true;
      } catch {
        setBoundId(prev);
        setMsg({ tone: "err", text: "网络异常,请重试" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [boundId, topicId],
  );

  const bind = useCallback(
    async (id: string, name: string): Promise<void> => {
      await patchBinding(id, `已绑定参照图《${name}》,生成初稿时生效`);
    },
    [patchBinding],
  );

  const clear = useCallback(async (): Promise<void> => {
    await patchBinding(null, "已清除参照图绑定");
  }, [patchBinding]);

  /** 上传(本地上传/剪贴板共用):媒体库 uploadMedia sha1 去重 → 登记图库行 → 自动绑定 */
  const upload = useCallback(
    async (file: File): Promise<void> => {
      if (!file.type.startsWith("image/")) {
        setMsg({ tone: "err", text: "仅支持图片文件(png/jpeg/webp)" });
        return;
      }
      if (file.size > SAMPLE_MAX_BYTES) {
        setMsg({ tone: "err", text: "参照图单张不超过 6MB" });
        return;
      }
      setBusy(true);
      setMsg(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/writing-samples", { method: "POST", body: form });
        const resp = (await res.json()) as ApiEnvelope<WritingSampleDto>;
        if (!res.ok || resp.code !== 0) {
          setMsg({ tone: "err", text: resp.message || `上传失败(${res.status})` });
          return;
        }
        setSamples((s) => [resp.data, ...s]);
        await patchBinding(resp.data.id, "已上传并绑定参照图,生成初稿时生效");
      } catch {
        setMsg({ tone: "err", text: "网络异常,请重试" });
      } finally {
        setBusy(false);
      }
    },
    [patchBinding],
  );

  // 剪贴板粘贴(仅挂载期;输入框/文本域内的粘贴不劫持)
  useEffect(() => {
    function onPaste(e: ClipboardEvent): void {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        e.preventDefault();
        void upload(file);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [upload]);

  async function rename(id: string): Promise<void> {
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/writing-samples/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const resp = (await res.json()) as ApiEnvelope<WritingSampleDto>;
      if (!res.ok || resp.code !== 0) {
        setMsg({ tone: "err", text: resp.message || `重命名失败(${res.status})` });
        return;
      }
      setSamples((s) => s.map((x) => (x.id === id ? resp.data : x)));
      setRenamingId(null);
    } catch {
      setMsg({ tone: "err", text: "网络异常,请重试" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(`/api/writing-samples/${id}`, { method: "DELETE" });
      const resp = (await res.json()) as ApiEnvelope;
      if (!res.ok || resp.code !== 0) {
        setMsg({ tone: "err", text: resp.message || `删除失败(${res.status})` });
        return;
      }
      setSamples((s) => s.filter((x) => x.id !== id));
      if (boundId === id) {
        // 服务端删除已事务置空绑定;本地仅同步显示态
        setBoundId(null);
        setMsg({ tone: "ok", text: "已删除参照图(专题绑定同步解除)" });
      }
    } catch {
      setMsg({ tone: "err", text: "网络异常,请重试" });
    } finally {
      setBusy(false);
    }
  }

  const bound = samples.find((s) => s.id === boundId) ?? null;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-sm border border-line bg-panel p-3">
      <div>
        <span className="text-[12px] font-semibold text-text-1">配图风格参照(可选)</span>
        <span className="ml-2 text-[11px] text-text-3">
          绑定后 AI 生成的图文将向参照图风格靠拢(配色/版式/字体气质);数据密集内容的信息卡不受影响
        </span>
      </div>
      <div className="flex items-start gap-3">
        {bound ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bound.mediaPath}
            alt={`参照图 ${bound.name}`}
            className="h-16 w-24 rounded-sm border border-line object-cover"
          />
        ) : (
          <div className="flex h-16 w-24 items-center justify-center rounded-sm border border-dashed border-line text-[11px] text-text-3">
            未绑定
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-text-2 hover:border-accent hover:text-text-1 disabled:opacity-50"
            >
              本地上传
            </button>
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              disabled={busy}
              className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-text-2 hover:border-accent hover:text-text-1 disabled:opacity-50"
            >
              从图库选择
            </button>
            {bound && (
              <button
                type="button"
                onClick={() => void clear()}
                disabled={busy}
                className="rounded-sm border border-line px-2.5 py-1 text-[11px] text-text-2 hover:border-red hover:text-red disabled:opacity-50"
              >
                清除绑定
              </button>
            )}
          </div>
          <span className="text-[11px] text-text-3">
            {bound
              ? `当前:${bound.name}`
              : boundId
                ? "当前参照图已不在图库(可能已被删除),请重新选择"
                : "支持选文件或直接 Ctrl/⌘+V 粘贴截图;单张 ≤6MB"}
          </span>
          {msg && (
            <span className={`text-[11px] ${msg.tone === "ok" ? "text-green" : "text-red"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {showLibrary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowLibrary(false)}
          role="presentation"
        >
          <div
            className="max-h-[70vh] w-full max-w-2xl overflow-y-auto rounded-sm border border-line bg-panel p-3"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="样例参照图库"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-text-1">样例参照图库</span>
              <button
                type="button"
                onClick={() => setShowLibrary(false)}
                className="text-[11px] text-text-3 hover:text-text-1"
              >
                关闭
              </button>
            </div>
            {samples.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-text-3">
                图库为空:先「本地上传」或直接粘贴图片
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {samples.map((s) => (
                  <div
                    key={s.id}
                    className={
                      "flex flex-col gap-1 rounded-sm border p-1.5 " +
                      (s.id === boundId ? "border-accent" : "border-line")
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.mediaPath}
                      alt={`样例图 ${s.name}`}
                      className="h-24 w-full rounded-sm border border-line object-cover"
                    />
                    {renamingId === s.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={renameValue}
                          maxLength={100}
                          autoFocus
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void rename(s.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          className="min-w-0 flex-1 rounded-sm border border-line bg-panel px-1.5 py-0.5 text-[11px] outline-none focus:border-accent"
                          aria-label="参照图名称"
                        />
                        <button
                          type="button"
                          onClick={() => void rename(s.id)}
                          disabled={busy}
                          className="text-[11px] text-accent disabled:opacity-50"
                        >
                          存
                        </button>
                      </div>
                    ) : (
                      <span className="truncate text-[11px] text-text-1" title={s.name}>
                        {s.name}
                      </span>
                    )}
                    <div className="flex items-center justify-between text-[11px]">
                      {s.id === boundId ? (
                        <span className="text-accent">当前绑定</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            void bind(s.id, s.name).then(() => setShowLibrary(false));
                          }}
                          disabled={busy}
                          className="text-text-2 hover:text-accent disabled:opacity-50"
                        >
                          绑定
                        </button>
                      )}
                      {renamingId === s.id ? null : (
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(s.id);
                              setRenameValue(s.name);
                            }}
                            className="text-text-3 hover:text-text-1"
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(s.id)}
                            disabled={busy}
                            className="text-text-3 hover:text-red disabled:opacity-50"
                          >
                            删除
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
