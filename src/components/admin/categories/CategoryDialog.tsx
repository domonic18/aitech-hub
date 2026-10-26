"use client";

/**
 * 分类新增/编辑弹窗(2026-10-16 后台增删改查,SkillDialog 同款骨架):
 * slug 仅新建可填——承载公开 URL(/category/<slug>/),建后不可改;
 * 描述空串落 null;排序决定编辑器下拉与站点分类导航的次序;
 * 原创开关(2026-10-20)决定文章进首页「博主文章」还是「推荐视频」板块。
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import DialogShell, { DialogActions } from "@/components/admin/DialogShell";
import { field } from "@/components/admin/form-fields";
import type { CategoryAdminRow } from "@/lib/content/categories-admin";
import type { ApiEnvelope } from "@/lib/http/response";

export default function CategoryDialog({
  label,
  category,
  buttonClass,
}: {
  label: string;
  category?: CategoryAdminRow;
  buttonClass?: string;
}) {
  const router = useRouter();
  const editing = category !== undefined;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [isOriginal, setIsOriginal] = useState(category?.isOriginal ?? false);
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const slugRef = useRef<HTMLInputElement>(null);

  const close = (): void => {
    setOpen(false);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // 更新 body 不含 slug:URL 红线,建后不可改
      const body = editing
        ? { name, description, isOriginal, sortOrder: Number.parseInt(sortOrder, 10) || 0 }
        : { slug, name, description, isOriginal, sortOrder: Number.parseInt(sortOrder, 10) || 0 };
      const res = await fetch(editing ? `/api/categories/${category.id}` : "/api/categories", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ApiEnvelope;
      if (data.code !== 0) {
        setError(data.message || `HTTP ${res.status}`);
        return;
      }
      close();
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = name.trim() !== "" && (editing || slug.trim() !== "");

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setTimeout(() => (editing ? null : slugRef.current?.focus()), 0);
        }}
        className={
          buttonClass ??
          "cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        }
      >
        {label}
      </button>
      {open && (
        <DialogShell width="lg" title={editing ? `编辑分类:${category.name}` : "新增分类"}>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <label className="text-xs text-text-3">
              slug *
              {editing && (
                <span className="text-amber">(建后不可改,公开 URL /category/slug/ 锚定)</span>
              )}
              <input
                ref={slugRef}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={editing}
                maxLength={100}
                placeholder="如 ai-agents(小写字母/数字/连字符)"
                className={`${field} mt-1 ${editing ? "opacity-60" : ""}`}
              />
            </label>
            <label className="text-xs text-text-3">
              名称 *
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder="如 AI 智能体"
                className={`${field} mt-1`}
              />
            </label>
            <label className="text-xs text-text-3">
              描述(选填,导航悬浮提示)
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={2}
                className={`${field} mt-1`}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-text-3">
              <input
                type="checkbox"
                checked={isOriginal}
                onChange={(e) => setIsOriginal(e.target.checked)}
                className="accent-[color:var(--accent)]"
              />
              原创分类(文章进首页「博主文章」与全部文章页;否则进「推荐视频」板块)
            </label>
            <label className="text-xs text-text-3">
              排序(小的在前,决定下拉与导航次序)
              <input
                type="number"
                min={0}
                max={9999}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className={`${field} mt-1`}
              />
            </label>
          </div>
          {error && <p className="mt-2 text-xs text-red">{error}</p>}
          <DialogActions>
            <button
              type="button"
              onClick={close}
              className="cursor-pointer rounded-sm border border-line bg-panel px-3 py-1.5 text-xs text-text-2 hover:border-line-hover"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || !canSubmit}
              onClick={() => void submit()}
              className="cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </DialogActions>
        </DialogShell>
      )}
    </>
  );
}
