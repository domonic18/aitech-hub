"use client";

/**
 * 一键发文弹窗(原型 admin-editor §4,M5-b):选 md + 图片 → 解析引用 →
 * 本地图按文件名匹配上传(sha1 去重)/ 外链交 media.transfer 批量转存 →
 * 引用替换为站内 URL → sessionStorage 交接给编辑器(/admin/posts/new?import=1)。
 * 逐图容错:失败保留原链并在交接 warning 中列出,不阻断整篇导入。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { type ApiEnvelope } from "@/lib/http/response";
import {
  type ImportMapping,
  type MdImageRef,
  IMPORT_MD_STORE_KEY,
  extractImageRefs,
  refBasename,
  replaceImageRefs,
} from "@/lib/media/import-md";
import { type TransferResult, MEDIA_LIMITS } from "@/lib/media/media-schema";
import { uploadImageFile } from "@/lib/media/upload-client";

type RefState = { status: "pending" | "uploading" | "done" | "failed"; target?: string };

/** 轮询节奏 1.5s 一次;次数按最坏转存时长(单张超时 × 张数)+ 缓冲推导,
 *  避免客户端先于 worker 放弃(评审 S2:30 张 × 15s 最坏 450s > 固定 180s 预算) */
const POLL_INTERVAL_MS = 1_500;
const POLL_BUFFER_MS = 30_000;

function pollTriesFor(count: number): number {
  return Math.ceil((count * MEDIA_LIMITS.fetchTimeoutMs + POLL_BUFFER_MS) / POLL_INTERVAL_MS);
}

export default function ImportPostsModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [mdName, setMdName] = useState<string | null>(null);
  const [refs, setRefs] = useState<MdImageRef[]>([]);
  const [states, setStates] = useState<Record<string, RefState>>({});
  const [running, setRunning] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pick(list: FileList): void {
    const arr = [...list];
    const md = arr.find((f) => /\.(md|markdown)$/i.test(f.name));
    setFiles(arr);
    setDoneMsg(null);
    setError(null);
    if (!md) {
      setMdName(null);
      setRefs([]);
      setStates({});
      setError("所选文件中没有 .md 文章");
      return;
    }
    void md.text().then((text) => {
      const parsed = extractImageRefs(text);
      setMdName(md.name);
      setRefs(parsed);
      setStates(Object.fromEntries(parsed.map((r) => [r.src, { status: "pending" }])));
    });
  }

  function patch(src: string, s: RefState): void {
    setStates((prev) => ({ ...prev, [src]: s }));
  }

  async function uploadOne(file: File): Promise<string | null> {
    if (file.size > MEDIA_LIMITS.maxUploadBytes) return null;
    const r = await uploadImageFile(file, file.name);
    return r.ok ? r.path : null;
  }

  async function transferExternals(urls: string[]): Promise<ImportMapping> {
    const post = await fetch("/api/media/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    if (!post.ok) return Object.fromEntries(urls.map((u) => [u, null]));
    const postBody = (await post.json().catch(() => null)) as ApiEnvelope<{
      jobId?: string;
    } | null> | null;
    const jobId = postBody?.data?.jobId;
    if (!jobId) return Object.fromEntries(urls.map((u) => [u, null]));
    // 轮询直至完成(转存任务在 worker 执行;超时预算按最坏抓取时长推导)
    for (let i = 0; i < pollTriesFor(urls.length); i += 1) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const poll = await fetch(`/api/media/import?job=${encodeURIComponent(jobId)}`);
      if (!poll.ok) continue;
      const body = (await poll.json().catch(() => null)) as ApiEnvelope<{
        state?: string;
        result?: TransferResult | null;
      } | null> | null;
      if (body?.data?.state === "completed" && body.data.result) {
        return body.data.result.mapping;
      }
      if (body?.data?.state === "failed") break;
    }
    return Object.fromEntries(urls.map((u) => [u, null]));
  }

  async function run(): Promise<void> {
    if (!mdName) return;
    setRunning(true);
    setError(null);
    const mdFile = files.find((f) => /\.(md|markdown)$/i.test(f.name));
    if (!mdFile) {
      setRunning(false);
      return;
    }
    const mdText = await mdFile.text();
    const mapping: ImportMapping = {};
    const warnings: string[] = [];

    // 1) 本地图:按解码后文件名与所选文件匹配,逐张上传
    const byName = new Map(
      files.filter((f) => !/\.(md|markdown)$/i.test(f.name)).map((f) => [f.name, f]),
    );
    for (const ref of refs) {
      if (ref.external) continue;
      const hit = byName.get(refBasename(ref.src));
      if (!hit) {
        patch(ref.src, { status: "failed" });
        warnings.push(`本地图片未选中,保留原链:${refBasename(ref.src)}`);
        continue;
      }
      patch(ref.src, { status: "uploading" });
      const target = await uploadOne(hit);
      if (target) {
        mapping[ref.src] = target;
        patch(ref.src, { status: "done", target });
      } else {
        patch(ref.src, { status: "failed" });
        warnings.push(`上传失败,保留原链:${refBasename(ref.src)}`);
      }
    }

    // 2) 外链:一批交 media.transfer,worker 逐张抓取转存
    const externals = refs.filter((r) => r.external);
    if (externals.length > MEDIA_LIMITS.maxBatchUrls) {
      warnings.push(
        `外链 ${externals.length} 张超出单批 ${MEDIA_LIMITS.maxBatchUrls} 张上限,本批保留原链,请分批导入`,
      );
    } else if (externals.length > 0) {
      for (const r of externals) patch(r.src, { status: "uploading" });
      const tMapping = await transferExternals(externals.map((r) => r.src));
      for (const r of externals) {
        const target = tMapping[r.src] ?? null;
        if (target) {
          mapping[r.src] = target;
          patch(r.src, { status: "done", target });
        } else {
          patch(r.src, { status: "failed" });
          warnings.push(`外链转存失败,保留原链:${r.src}`);
        }
      }
    }

    // 3) 替换引用 → sessionStorage 交接进编辑器
    const replaced = replaceImageRefs(mdText, mapping);
    sessionStorage.setItem(IMPORT_MD_STORE_KEY, JSON.stringify({ contentMd: replaced, warnings }));
    const okCount = Object.values(mapping).filter(Boolean).length;
    setDoneMsg(`完成 ${okCount}/${refs.length} 张替换,即将进入编辑器…`);
    setRunning(false);
    setTimeout(() => {
      onClose();
      router.push("/admin/posts/new?import=1");
    }, 800);
  }

  const matchedCount = refs.filter((r) => !r.external).length;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-[560px] overflow-y-auto rounded-md border border-line bg-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">一键发文(md 导入)</h3>
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

        <p className="mt-2 text-xs text-text-3">
          选择 Markdown 文章与其引用的本地图片(按文件名匹配);外链图自动转存入媒体库;上传与转存 sha1
          去重。完成后进入编辑器,失败项保留原链。
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) pick(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={running}
          onClick={() => fileRef.current?.click()}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-3 py-2 text-[13px] text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-60"
        >
          <svg className="ic" aria-hidden="true">
            <use href="#i-paperclip" />
          </svg>
          选择 md 与图片
        </button>
        {error && <span className="ml-2 text-xs text-red">{error}</span>}

        {mdName && (
          <>
            <div className="mt-3 rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs">
              <b className="text-text-1">{mdName}</b>
              <span className="ml-2 text-text-3">
                图片引用 {refs.length} 处(本地图 {matchedCount} / 外链 {refs.length - matchedCount})
                · 已选文件 {files.length - 1} 个
              </span>
            </div>
            {refs.length > 0 && (
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
                {refs.map((r) => {
                  const s = states[r.src] ?? { status: "pending" };
                  return (
                    <li key={r.src} className="flex items-center gap-2">
                      <span
                        className={
                          s.status === "done"
                            ? "text-accent"
                            : s.status === "failed"
                              ? "text-red"
                              : "text-text-3"
                        }
                      >
                        {s.status === "done"
                          ? "✓"
                          : s.status === "failed"
                            ? "✗"
                            : s.status === "uploading"
                              ? "…"
                              : "·"}
                      </span>
                      <span className="truncate font-mono text-[11px] text-text-2" title={r.src}>
                        {r.external ? "[外链] " : ""}
                        {r.src}
                      </span>
                      {s.target && (
                        <span className="ml-auto shrink-0 truncate font-mono text-[10px] text-text-3">
                          {s.target}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={running || !mdName}
            onClick={() => void run()}
            className="cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "导入中…" : "开始导入"}
          </button>
          {doneMsg && <span className="text-xs text-accent">{doneMsg}</span>}
        </div>
      </div>
    </div>
  );
}
