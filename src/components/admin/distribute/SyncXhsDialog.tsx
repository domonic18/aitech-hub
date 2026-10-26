"use client";

/**
 * 小红书分发弹窗(M49 批X2,半自动闭环):状态机驱动四态——
 * 未生成(生成入口)/ pending(AI 改写中,轮询)/ ready(物料卡:标题·正文·
 * 标签一键复制 + 3:4 封面预览 + 原文图清单,回填笔记链接标记已发布)/
 * synced(笔记链接 + 重新生成)。发布动作永远人工(无官方发布 API,plan M49)。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import type { ApiEnvelope } from "@/lib/http/response";

const XHS_TITLE_MAX = 20;
const POLL_MS = 3_000;
const POLL_MAX = 40; // 3s × 40 = 2min:LLM 改写 + 封面渲染秒级到十几秒,兜底轮询

type XhsMaterial = {
  draft: { title: string; content: string; tags: string[] };
  coverMediaPath: string;
  readyAt: string;
  noteUrl?: string;
};

type XhsMaterialView = {
  status: string | null;
  material: XhsMaterial | null;
  lastError: string | null;
  postTitle: string;
  coverUrl: string | null;
  images: Array<{ path: string; url: string }>;
};

/** 物料取用(统一包络剥壳;失败抛人话) */
async function fetchMaterial(postId: string): Promise<XhsMaterialView> {
  const res = await fetch(`/api/distribute/xiaohongshu/material?postId=${postId}`);
  const json = (await res.json().catch(() => null)) as ApiEnvelope<XhsMaterialView> | null;
  if (!res.ok || json?.code !== 0 || !json.data) {
    throw new Error(json?.message ?? `读取物料失败(${res.status})`);
  }
  return json.data;
}

export default function SyncXhsDialog({
  postId,
  onClose,
}: {
  postId: string;
  onClose: () => void;
}): React.ReactElement {
  const router = useRouter();
  const [view, setView] = useState<XhsMaterialView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteUrl, setNoteUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await fetchMaterial(postId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // pending → 3s 轮询至 ready/failed(上限由用户关闭弹窗自然终止)
  useEffect(() => {
    if (view?.status !== "pending") return;
    const t = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(t);
  }, [view?.status, refresh]);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/distribute/xiaohongshu/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      if (!res.ok || json?.code !== 0) {
        setError(json?.message ?? `提交失败(${res.status})`);
        return;
      }
      setLoading(true);
      await refresh();
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (key: string, text: string): Promise<void> => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const backfill = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/distribute/xiaohongshu/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postId, noteUrl: noteUrl.trim() }),
      });
      const json = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      if (!res.ok || json?.code !== 0) {
        setError(json?.message ?? `回填失败(${res.status})`);
        return;
      }
      await refresh();
      router.refresh();
    } catch {
      setError("网络错误,请重试");
    } finally {
      setBusy(false);
    }
  };

  const status = view?.status ?? null;
  const material = view?.material ?? null;

  const body = (() => {
    if (loading) {
      return <p className="px-1 py-6 text-center text-xs text-text-3">读取中…</p>;
    }
    if (status === null) {
      return (
        <div className="px-1 py-6 text-center text-xs text-text-3">
          <p>
            将把「{view?.postTitle}」改写为小红书笔记(标题 ≤20 字 · 正文 ≤1000 字 · 话题标签),并渲染
            3:4 封面卡。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="mt-3 cursor-pointer rounded-sm bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "提交中…" : "生成小红书笔记"}
          </button>
        </div>
      );
    }
    if (status === "pending") {
      return (
        <p className="px-1 py-8 text-center text-xs text-accent">
          AI 改写中…(生成小红书体文案与封面卡,约需十几秒)
        </p>
      );
    }
    if (status === "failed") {
      return (
        <div className="px-1 py-6 text-center text-xs">
          <p className="text-red">物料生成失败:{view?.lastError ?? "未知错误"}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="mt-3 cursor-pointer rounded-sm bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            重新生成
          </button>
        </div>
      );
    }
    if (material === null) {
      return <p className="px-1 py-6 text-center text-xs text-text-3">物料缺失,请重新生成</p>;
    }
    const d = material.draft;
    return (
      <div className="flex flex-col gap-3 text-xs">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-text-2">
              标题{" "}
              <span className="font-mono text-text-3">
                {[...d.title].length}/{XHS_TITLE_MAX}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void copy("title", d.title)}
              className="cursor-pointer text-accent hover:underline"
            >
              {copied === "title" ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <p className="rounded-sm border border-line bg-panel px-3 py-2 leading-5">{d.title}</p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-text-2">
              正文 <span className="font-mono text-text-3">{[...d.content].length}/1000</span>
            </span>
            <button
              type="button"
              onClick={() =>
                void copy(
                  "content",
                  `${d.title}\n\n${d.content}\n\n${d.tags.map((t) => `#${t}`).join(" ")}`,
                )
              }
              className="cursor-pointer text-accent hover:underline"
            >
              {copied === "content" ? "已复制 ✓" : "复制全部"}
            </button>
          </div>
          <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-sm border border-line bg-panel px-3 py-2 leading-5">
            {d.content}
          </pre>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-text-2">话题标签</span>
            <button
              type="button"
              onClick={() => void copy("tags", d.tags.map((t) => `#${t}`).join(" "))}
              className="cursor-pointer text-accent hover:underline"
            >
              {copied === "tags" ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.tags.map((t) => (
              <span key={t} className="rounded-sm bg-panel-2 px-2 py-0.5 text-[11px] text-text-2">
                #{t}
              </span>
            ))}
          </div>
        </div>
        {view?.coverUrl && (
          <div>
            <span className="font-medium text-text-2">3:4 封面卡(右键另存)</span>
            {/* eslint-disable-next-line @next/next/no-img-element -- 站内媒体路径预览 */}
            <img
              src={view.coverUrl}
              alt="小红书封面卡"
              className="mt-1 w-40 rounded-sm border border-line"
            />
          </div>
        )}
        {view && view.images.length > 0 && (
          <div>
            <span className="font-medium text-text-2">原文配图(逐张下载后作为笔记图片)</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {view.images.map((im, i) => (
                <a
                  key={im.path}
                  href={im.url}
                  download
                  className="rounded-sm border border-line px-2 py-1 text-[11px] text-accent hover:bg-accent-dim"
                >
                  图 {i + 1}
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-sm border border-line bg-panel-2 px-3 py-2.5">
          <p className="text-[11px] text-text-3">
            小红书无公开发布 API:复制物料到
            <a
              href="https://creator.xiaohongshu.com"
              target="_blank"
              rel="noreferrer"
              className="mx-0.5 text-accent hover:underline"
            >
              创作服务平台
            </a>
            手动发布,完成后把笔记链接回填到这里。
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={noteUrl || material.noteUrl || ""}
              onChange={(e) => setNoteUrl(e.target.value)}
              placeholder="粘贴小红书笔记链接"
              className="min-w-0 flex-1 rounded-sm border border-line bg-panel px-3 py-1.5 text-xs text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || noteUrl.trim() === ""}
              onClick={() => void backfill()}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              标记已发布
            </button>
          </div>
          {material.noteUrl && (
            <p className="mt-1.5 text-[11px] text-green">
              已发布:
              <a
                href={material.noteUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-1 hover:underline"
              >
                {material.noteUrl}
              </a>
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void generate()}
          className="w-fit cursor-pointer text-[11px] text-text-3 hover:text-accent disabled:opacity-50"
        >
          重新生成(AI 重写,覆盖当前物料)
        </button>
      </div>
    );
  })();

  return (
    <DialogShell width="2xl" title="分发到小红书(半自动)">
      {body}
      {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
      <DialogActions>
        <button
          type="button"
          onClick={() => {
            onClose();
            router.refresh();
          }}
          className="cursor-pointer rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
        >
          关闭
        </button>
      </DialogActions>
    </DialogShell>
  );
}
