"use client";

/**
 * 关键词直连管理(M66):新增 / 编辑 / 删除 / 启停。改动后 router.refresh()
 * 由 RSC 回读最新列表(命中次数等服务端字段不本地推算)。一条关键词只能
 * 挂文章(postId)或填固定话术(replyText),二者至少一项。
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { KeywordRow } from "@/lib/channel/wechat-mp/admin";

const INPUT =
  "w-full rounded-sm border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-text-1 outline-none transition-colors focus:border-accent";
const BTN_PRIMARY =
  "cursor-pointer rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60";
const BTN_GHOST =
  "cursor-pointer rounded-sm border border-line bg-panel px-2.5 py-1 text-xs text-text-2 hover:border-line-hover hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-60";

interface ApiBody {
  code: number;
  message?: string;
}

type Target = "post" | "text";

function targetOf(row: KeywordRow): Target {
  return row.postId ? "post" : "text";
}

function formatCn(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

export default function KeywordManager({ initial }: { initial: KeywordRow[] }): React.ReactElement {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [target, setTarget] = useState<Target>("post");
  const [postId, setPostId] = useState("");
  const [replyText, setReplyText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm(): void {
    setKeyword("");
    setTarget("post");
    setPostId("");
    setReplyText("");
    setEditingId(null);
    setError(null);
  }

  function beginEdit(row: KeywordRow): void {
    setEditingId(row.id);
    setKeyword(row.keyword);
    setTarget(targetOf(row));
    setPostId(row.postId ?? "");
    setReplyText(row.replyText ?? "");
    setError(null);
  }

  function payload(): Record<string, unknown> | null {
    const kw = keyword.trim();
    if (!kw) {
      setError("请填关键词");
      return null;
    }
    if (target === "post" && !/^\d+$/.test(postId.trim())) {
      setError("请填文章 id(数字)");
      return null;
    }
    if (target === "text" && !replyText.trim()) {
      setError("请填固定话术");
      return null;
    }
    return {
      keyword: kw,
      postId: target === "post" ? postId.trim() : null,
      replyText: target === "text" ? replyText.trim() : null,
    };
  }

  async function submit(): Promise<void> {
    const body = payload();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const url = editingId ? `/api/wechat-mp/keywords/${editingId}` : "/api/wechat-mp/keywords";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || json?.code !== 0) {
        setError(json?.message ?? "保存失败,请重试");
        return;
      }
      resetForm();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: KeywordRow): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wechat-mp/keywords/${row.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          keyword: row.keyword,
          postId: row.postId,
          replyText: row.replyText,
          isEnabled: !row.isEnabled,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || json?.code !== 0) {
        setError(json?.message ?? "切换失败,请重试");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: KeywordRow): Promise<void> {
    if (!window.confirm(`删除关键词「${row.keyword}」?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wechat-mp/keywords/${row.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as ApiBody | null;
      if (!res.ok || json?.code !== 0) {
        setError(json?.message ?? "删除失败,请重试");
        return;
      }
      if (editingId === row.id) resetForm();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-line bg-panel px-4 py-4">
        <h3 className="mb-3 text-[13px] font-semibold">
          {editingId ? "编辑关键词" : "新增关键词"}
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-text-2">关键词(1-50 字)</span>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              maxLength={50}
              placeholder="如:会员、价格、怎么投稿"
              className={INPUT}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-text-2">回复内容</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as Target)}
              className={INPUT}
            >
              <option value="post">挂文章(填文章 id)</option>
              <option value="text">固定话术</option>
            </select>
          </label>
          {target === "post" ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-text-2">文章 id</span>
              <input
                value={postId}
                onChange={(e) => setPostId(e.target.value)}
                inputMode="numeric"
                placeholder="如 313"
                className={`${INPUT} font-mono`}
              />
            </label>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-text-2">固定话术(≤2000 字)</span>
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                maxLength={2000}
                placeholder="回复正文,可含站内路径"
                className={INPUT}
              />
            </label>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={submit} disabled={busy} className={BTN_PRIMARY}>
            {busy ? "提交中…" : editingId ? "保存修改" : "新增"}
          </button>
          {editingId ? (
            <button type="button" onClick={resetForm} disabled={busy} className={BTN_GHOST}>
              取消编辑
            </button>
          ) : null}
          {error ? <span className="text-xs text-red">{error}</span> : null}
        </div>
      </section>

      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-panel-2 text-xs text-text-2">
              <th className="px-4 py-2.5 font-medium">关键词</th>
              <th className="px-3 py-2.5 font-medium">回复内容</th>
              <th className="px-3 py-2.5 font-medium">命中</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">更新</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {initial.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-b-0 hover:bg-panel-2">
                <td className="px-4 py-2.5 font-medium text-text-1">{row.keyword}</td>
                <td className="max-w-[320px] px-3 py-2.5">
                  {row.postId ? (
                    <span className="text-text-2">
                      文章 <span className="font-mono text-xs">{row.postId}</span>
                      {row.postTitle ? ` · ${row.postTitle}` : ""}
                    </span>
                  ) : (
                    <span className="truncate text-text-2" title={row.replyText ?? ""}>
                      {row.replyText}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-text-2">{row.hitCount}</td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(row)}
                    disabled={busy}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium ${
                      row.isEnabled ? "bg-green/12 text-green" : "bg-panel-2 text-text-3"
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                    {row.isEnabled ? "启用" : "停用"}
                  </button>
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-text-3">
                  {formatCn(row.updatedAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      onClick={() => beginEdit(row)}
                      disabled={busy}
                      className={BTN_GHOST}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(row)}
                      disabled={busy}
                      className="cursor-pointer rounded-sm border border-red/30 bg-red/5 px-2.5 py-1 text-xs text-red hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {initial.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs text-text-3">
                  还没有关键词,高频问题建议先配几条
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
