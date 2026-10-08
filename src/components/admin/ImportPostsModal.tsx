"use client";

/**
 * 一键发文弹窗(原型 admin-editor §4,M5-b;M16 改造):md 与图片分离入口,
 * 多次选择累积合并(跨目录补选不互清);引用列表逐条「选图」补选(立即上传)/
 * 失败行「重试」。「选择文件夹(自动配图)」走 webkitdirectory 目录选择,一次选中
 * 文章目录即自动收集其中全部图片并入、目录内 md 自动选为文章,免逐张挑图。
 * 本地图按文件名匹配上传(sha1 去重)/ 外链交 media.transfer
 * 批量转存 → 引用替换为站内 URL → sessionStorage 交接给编辑器。
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

const MD_RE = /\.(md|markdown)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export default function ImportPostsModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const router = useRouter();
  const mdRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const pickRefRef = useRef<HTMLInputElement>(null);
  /** 已上传映射(ref.src → 站内路径):补选/重试即时上传落这里,run() 优先复用不重传 */
  const overridesRef = useRef<ImportMapping>({});
  /** 选中的 md 文件本体(展示只留 mdName,内容读取走 ref) */
  const mdFileRef = useRef<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [mdName, setMdName] = useState<string | null>(null);
  const [refs, setRefs] = useState<MdImageRef[]>([]);
  const [states, setStates] = useState<Record<string, RefState>>({});
  /** 当前补选目标引用(ref.src);共享一个隐藏 input 驱动逐行「选图」 */
  const [pickTarget, setPickTarget] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 落定 md 文章(解析引用、重置已传映射);pickMd 与目录自动识别共用 */
  function applyMd(md: File): void {
    setDoneMsg(null);
    setError(null);
    void md.text().then((text) => {
      mdFileRef.current = md;
      const parsed = extractImageRefs(text);
      overridesRef.current = {};
      setMdName(md.name);
      setRefs(parsed);
      setStates(Object.fromEntries(parsed.map((r) => [r.src, { status: "pending" }])));
    });
  }

  /** md 选择(可随时换 md;换 md 重置引用与已传映射) */
  function pickMd(list: FileList): void {
    const md = [...list].find((f) => MD_RE.test(f.name));
    if (!md) {
      setError("所选文件中没有 .md 文章");
      return;
    }
    applyMd(md);
  }

  /** 图片选择:按文件名去重追加,不清空已有选择(跨目录多次补选) */
  function addImages(list: Iterable<File>): void {
    const incoming = [...list].filter((f) => !MD_RE.test(f.name) && IMAGE_RE.test(f.name));
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name));
      return [...prev, ...incoming.filter((f) => !seen.has(f.name))];
    });
    setError(null);
  }

  /** 目录选择(webkitdirectory):一次选中文章目录即自动收集——目录内(含子目录)全部
   *  图片并入已选;目录里有 md 且尚未选文章时自动选为文章。免逐张挑图(图与 md
   *  常分处不同层级目录)。目录既无图片也无 md 时给出提示。 */
  function addDirectory(list: FileList): void {
    const all = [...list];
    const imgs = all.filter((f) => !MD_RE.test(f.name) && IMAGE_RE.test(f.name));
    if (imgs.length > 0) addImages(imgs);
    const md = mdName ? undefined : all.find((f) => MD_RE.test(f.name));
    if (md) applyMd(md);
    if (imgs.length === 0 && !md && !mdName) {
      setError("所选文件夹中没有图片或 .md 文章");
    }
  }

  function patch(src: string, s: RefState): void {
    setStates((prev) => ({ ...prev, [src]: s }));
  }

  async function uploadOne(file: File): Promise<string | null> {
    if (file.size > MEDIA_LIMITS.maxUploadBytes) return null;
    const r = await uploadImageFile(file, file.name);
    return r.ok ? r.path : null;
  }

  /** 单引用立即上传(补选/本地重试):结果写 overrides,状态点实时更新 */
  async function uploadRefNow(src: string, file: File): Promise<void> {
    patch(src, { status: "uploading" });
    const target = await uploadOne(file);
    if (target) {
      overridesRef.current[src] = target;
      patch(src, { status: "done", target });
    } else {
      delete overridesRef.current[src];
      patch(src, { status: "failed" });
    }
  }

  /** 单外链重试:走同一转存通道单条入队并轮询 */
  async function transferOne(url: string): Promise<void> {
    patch(url, { status: "uploading" });
    const mapping = await transferExternals([url]);
    const target = mapping[url] ?? null;
    if (target) {
      overridesRef.current[url] = target;
      patch(url, { status: "done", target });
    } else {
      patch(url, { status: "failed" });
    }
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
    const mdFile = mdFileRef.current;
    if (!mdFile) {
      setRunning(false);
      setError("md 内容丢失,请重新选择 .md 文章");
      return;
    }
    const mdText = await mdFile.text();
    const mapping: ImportMapping = {};
    const warnings: string[] = [];

    // 1) 本地图:补选/重试已上传的走 overrides;余下按文件名匹配所选文件上传
    const byName = new Map(files.filter((f) => !MD_RE.test(f.name)).map((f) => [f.name, f]));
    for (const ref of refs) {
      if (ref.external) continue;
      const pre = overridesRef.current[ref.src];
      if (pre) {
        mapping[ref.src] = pre;
        patch(ref.src, { status: "done", target: pre });
        continue;
      }
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

    // 2) 外链:未即时重试过的一批交 media.transfer;已重试成功的走 overrides
    const externals = refs.filter((r) => r.external);
    const pendingExt = externals.filter((r) => !overridesRef.current[r.src]);
    if (pendingExt.length > MEDIA_LIMITS.maxBatchUrls) {
      warnings.push(
        `外链 ${pendingExt.length} 张超出单批 ${MEDIA_LIMITS.maxBatchUrls} 张上限,本批保留原链,请分批导入`,
      );
    } else if (pendingExt.length > 0) {
      for (const r of pendingExt) patch(r.src, { status: "uploading" });
      const tMapping = await transferExternals(pendingExt.map((r) => r.src));
      Object.assign(overridesRef.current, tMapping);
    }
    for (const r of externals) {
      const target = overridesRef.current[r.src] ?? null;
      if (target) {
        mapping[r.src] = target;
        patch(r.src, { status: "done", target });
      } else {
        patch(r.src, { status: "failed" });
        warnings.push(`外链转存失败,保留原链:${r.src}`);
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

  const byName = new Map(files.filter((f) => !MD_RE.test(f.name)).map((f) => [f.name, f]));
  const matchedCount = refs.filter((r) => !r.external).length;

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
          推荐用「选择文件夹(自动配图)」一次选中文章目录:系统自动读取其中的 md
          并收集全部图片(含子目录,按文件名匹配)。也可分别选择 md
          与图片;外链图自动转存入媒体库;上传与转存 sha1 去重。完成后进入编辑器,失败项保留原链。
        </p>

        <input
          ref={mdRef}
          type="file"
          accept=".md,.markdown"
          hidden
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) pickMd(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={imgRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) addImages(e.target.files);
            e.target.value = "";
          }}
        />
        {/* 目录选择(webkitdirectory):onChange 的 FileList 含目录内全部文件
            (webkitRelativePath 带相对路径,匹配仍走 basename)。TS 未收录该
            非标准属性,以对象展开透传 DOM attribute。 */}
        <input
          ref={dirRef}
          type="file"
          hidden
          multiple
          {...{ webkitdirectory: "", directory: "" }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) addDirectory(e.target.files);
            e.target.value = "";
          }}
        />
        {/* 逐引用补选:显式为该引用选定的文件即时上传,不要求文件名匹配 */}
        <input
          ref={pickRefRef}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            const src = pickTarget;
            e.target.value = "";
            setPickTarget(null);
            if (!file || !src) return;
            setFiles((prev) => (prev.some((f) => f.name === file.name) ? prev : [...prev, file]));
            void uploadRefNow(src, file);
          }}
        />

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={running}
            onClick={() => mdRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-3 py-2 text-[13px] text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-60"
          >
            <svg className="ic" aria-hidden="true">
              <use href="#i-paperclip" />
            </svg>
            {mdName ? "重选 md" : "选择 md"}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => dirRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-3 py-2 text-[13px] text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-60"
          >
            <svg className="ic" aria-hidden="true">
              <use href="#i-folder" />
            </svg>
            选择文件夹(自动配图)
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => imgRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-3 py-2 text-[13px] text-text-2 hover:border-line-hover hover:text-text-1 disabled:opacity-60"
          >
            <svg className="ic" aria-hidden="true">
              <use href="#i-picture" />
            </svg>
            添加图片
          </button>
          {error && <span className="text-xs text-red">{error}</span>}
        </div>

        {mdName && (
          <>
            <div className="mt-3 rounded-sm border border-line bg-panel-2 px-3 py-2 text-xs">
              <b className="text-text-1">{mdName}</b>
              <span className="ml-2 text-text-3">
                图片引用 {refs.length} 处(本地图 {matchedCount} / 外链 {refs.length - matchedCount})
                · 已选图片 {files.length} 张
              </span>
            </div>
            {refs.length > 0 && (
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
                {refs.map((r) => {
                  const s = states[r.src] ?? { status: "pending" };
                  const hit = r.external ? undefined : byName.get(refBasename(r.src));
                  const canRetryLocal = !r.external && s.status === "failed" && !!hit;
                  const canPick = !r.external && s.status !== "done" && !hit;
                  const action = canRetryLocal ? (
                    <button
                      type="button"
                      className="cursor-pointer rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-3 hover:text-text-1"
                      onClick={() => void uploadRefNow(r.src, hit as File)}
                    >
                      重试
                    </button>
                  ) : canPick ? (
                    <button
                      type="button"
                      disabled={running}
                      className="cursor-pointer rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-3 hover:text-text-1 disabled:opacity-60"
                      onClick={() => {
                        setPickTarget(r.src);
                        pickRefRef.current?.click();
                      }}
                    >
                      选图
                    </button>
                  ) : r.external && s.status === "failed" ? (
                    <button
                      type="button"
                      className="cursor-pointer rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-3 hover:text-text-1"
                      onClick={() => void transferOne(r.src)}
                    >
                      重试
                    </button>
                  ) : null;
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
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        {s.target && (
                          <span className="max-w-[160px] truncate font-mono text-[10px] text-text-3">
                            {s.target}
                          </span>
                        )}
                        {action}
                      </span>
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
