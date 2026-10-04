"use client";

/**
 * 配套文章关联弹窗(M11 批②):打开时拉取已发布文章选项(+当前关联标记),
 * 勾选后整体替换保存(空选 = 解除全部关联)。选项由服务端限制已发布,
 * 至多 500 条(published_at 倒序)。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { field } from "@/components/admin/form-fields";
import type { ApiEnvelope } from "@/lib/http/response";
import DialogShell, { DialogActions } from "@/components/admin/DialogShell";

interface PostOption {
  id: string;
  title: string;
  linked: boolean;
}

export default function PostsLinkDialog({
  repoId,
  fullName,
}: {
  repoId: number;
  fullName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<PostOption[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/github/repos/${repoId}/posts`);
      const body = (await res.json()) as ApiEnvelope<{ items: PostOption[] }>;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setOptions(body.data.items);
      setChecked(new Set(body.data.items.filter((o) => o.linked).map((o) => o.id)));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/github/repos/${repoId}/posts`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postIds: [...checked] }),
      });
      const body = (await res.json()) as ApiEnvelope;
      if (body.code !== 0) {
        setError(body.message || `HTTP ${res.status}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const filtered = keyword.trim()
    ? options.filter((o) => o.title.toLowerCase().includes(keyword.trim().toLowerCase()))
    : options;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        className="cursor-pointer rounded-sm px-2 py-1 text-text-2 hover:bg-panel-2"
        title={`关联「${fullName}」的配套文章`}
      >
        文章
      </button>
      {open && (
        <DialogShell width="xl" scroll title={`配套文章 · ${fullName}`}>
          <p className="mt-2 text-[11px] text-text-3">
            勾选该仓库的配套教程(仅已发布文章可关联),保存整体替换;空选解除全部关联。
          </p>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="按标题过滤…"
            className={`mt-2 ${field}`}
          />
          <div className="mt-2 max-h-72 space-y-px overflow-y-auto">
            {loading && <p className="py-6 text-center text-xs text-text-3">加载中…</p>}
            {!loading && filtered.length === 0 && (
              <p className="py-6 text-center text-xs text-text-3">无匹配文章</p>
            )}
            {filtered.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover:bg-panel-2"
              >
                <input
                  type="checkbox"
                  checked={checked.has(o.id)}
                  onChange={(e) => {
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(o.id);
                      else next.delete(o.id);
                      return next;
                    });
                  }}
                  className="accent-[var(--accent)]"
                />
                <span className="truncate text-text-1" title={o.title}>
                  {o.title}
                </span>
              </label>
            ))}
          </div>
          {error && <p className="mt-2 font-mono text-xs text-red">{error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-sm border border-line px-3 py-1.5 text-xs text-text-2 hover:bg-panel-2"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void save()}
              className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "保存中…" : `保存(${checked.size})`}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </>
  );
}
